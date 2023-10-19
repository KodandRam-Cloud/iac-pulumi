import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as ip from "ip";
const cfg = new pulumi.Config("aws-deploy");

const vpcCfgName = cfg.require("vpcConfigName");
const vpcRange = cfg.require("vpcRange");
const vpcTenancy = cfg.require("vpcTenancyType");
const gatewayCfgName = cfg.require("gatewayConfigName");
const gatewayAttachCfgName = cfg.require("gatewayAttachConfigName");
const publicRTCfgName = cfg.require("publicRTConfigName");
const privateRTCfgName = cfg.require("privateRTConfigName");
const azLimit = cfg.getNumber("azLimit");
const subnetBits = cfg.getNumber("subnetBits");

const publicRouteCfgName = cfg.require("publicRouteConfigName");
const publicDestinationRange = cfg.require("publicDestinationRange");
const publicSubnetPrefixCfg = cfg.require("publicSubnetConfigPrefix");
const privateSubnetPrefixCfg = cfg.require("privateSubnetConfigPrefix");
const publicRTSubnetAssocPrefixCfg = cfg.require("publicRTSubnetAssocConfigPrefix");
const privateRTSubnetAssocPrefixCfg = cfg.require("privateRTSubnetAssocConfigPrefix");

const sgDescription = cfg.require("sgDesc");
const sgName = cfg.require("sgConfigName");
const ingressPortsAllowed = cfg.require("ingressPortsAllowed").split(",");
const ingressCIDRsAllowed = cfg.require("ingressCIDRsAllowed").split(",");

const vpc = new aws.ec2.Vpc(vpcCfgName, {
    cidrBlock: vpcRange,
    instanceTenancy: vpcTenancy,
    tags: {
        Name: vpcCfgName,
    },
});

const ingressRulesTransformed = ingressPortsAllowed.map(port => ({
    protocol: "tcp",
    fromPort: parseInt(port, 10),
    toPort: parseInt(port, 10),
    cidrBlocks: ingressCIDRsAllowed,
}));

const applicationSG = new aws.ec2.SecurityGroup(sgName, {
    vpcId: vpc.id,
    description: sgDescription,
    tags: {
        Name: sgName,
    },
    ingress: ingressRulesTransformed,
});

const instanceCfgType = cfg.require("instanceConfigType");
const imgId = cfg.require("imgConfigId");
const keyCfgName = cfg.require("keyConfigName");
const volumeCfgSize = cfg.getNumber("volumeConfigSize");
const volumeCfgType = cfg.require("volumeConfigType");
const terminateOnDelete = cfg.getBoolean("terminateOnDeleteFlag");
const ec2CfgName = cfg.require("ec2ConfigName");

async function deploy() {
    try {
        const availableZones = await aws.getAvailabilityZones();
        const zonesToUse = availableZones.names.slice(0, azLimit!);
        const totalSubnetsCount = zonesToUse.length * 2;
        const subnetsRanges = deriveCIDRSubnets(vpcRange, totalSubnetsCount, subnetBits!);

        if (subnetsRanges instanceof Error) {
            throw new pulumi.RunError("Failed to derive subnet CIDRs: " + subnetsRanges.message);
        }

        let publicNetArray: aws.ec2.Subnet[] = [];
        let privateNetArray: aws.ec2.Subnet[] = [];

        const netGateway = new aws.ec2.InternetGateway(gatewayCfgName, {
            tags: {
                Name: gatewayCfgName,
            },
        });

        const gwAttach = new aws.ec2.InternetGatewayAttachment(gatewayAttachCfgName, {
            vpcId: vpc.id,
            internetGatewayId: netGateway.id,
        });

        const publicRT = new aws.ec2.RouteTable(publicRTCfgName, {
            vpcId: vpc.id,
            tags: {
                Name: publicRTCfgName,
            },
        });

        const publicRoute = new aws.ec2.Route(publicRouteCfgName, {
            routeTableId: publicRT.id,
            destinationCidrBlock: publicDestinationRange,
            gatewayId: netGateway.id,
        });

        const privateRT = new aws.ec2.RouteTable(privateRTCfgName, {
            vpcId: vpc.id,
            tags: {
                Name: privateRTCfgName,
            },
        });

        zonesToUse.forEach((zone, idx) => {
            const publicSubnet = new aws.ec2.Subnet(`${publicSubnetPrefixCfg}-${idx}`, {
                vpcId: vpc.id,
                availabilityZone: zone,
                cidrBlock: subnetsRanges[idx],
                mapPublicIpOnLaunch: true,
                tags: {
                    Name: `${publicSubnetPrefixCfg}-${idx}`,
                },
            });

            publicNetArray.push(publicSubnet);

            const privateSubnet = new aws.ec2.Subnet(`${privateSubnetPrefixCfg}-${idx}`, {
                vpcId: vpc.id,
                availabilityZone: zone,
                cidrBlock: subnetsRanges[zonesToUse.length + idx],
                tags: {
                    Name: `${privateSubnetPrefixCfg}-${idx}`,
                },
            });

            privateNetArray.push(privateSubnet);
        });

        publicNetArray.forEach((subnet, idx) => {
            new aws.ec2.RouteTableAssociation(`${publicRTSubnetAssocPrefixCfg}-${idx}`, {
                subnetId: subnet.id,
                routeTableId: publicRT.id,
            });
        });

        privateNetArray.forEach((subnet, idx) => {
            new aws.ec2.RouteTableAssociation(`${privateRTSubnetAssocPrefixCfg}-${idx}`, {
                subnetId: subnet.id,
                routeTableId: privateRT.id,
            });
        });

        const ec2InstanceDeploy = new aws.ec2.Instance(ec2CfgName, {
            instanceType: instanceCfgType,
            ami: imgId,
            keyName: keyCfgName,
            subnetId: publicNetArray[0]?.id,
            vpcSecurityGroupIds: [applicationSG.id],
            disableApiTermination: cfg.getBoolean("apiTerminationFlag"),
            rootBlockDevice: {
                volumeSize: volumeCfgSize!,
                volumeType: volumeCfgType,
                deleteOnTermination: terminateOnDelete!,
            },
            tags: {
                Name: ec2CfgName,
            },
        });

    } catch (error) {
        console.error("Deployment Error:", error);
    }
}

// CIDR Calculation function
function deriveCIDRSubnets(parentCIDR: string, numSubnets: number, bitsToMask: number): string[] | Error {
    try {
        if (bitsToMask > 32) {
            throw new Error("Bits to mask exceeds the available bits in the parent CIDR");
        }

        function ipToInt(ip: string): number {
            return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
        }

        function intToIp(int: number): string {
            return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
        }

        const subnetSize = 1 << (32 - bitsToMask);
        const ipRange = ip.cidrSubnet(parentCIDR);
        let baseIpInt = ipToInt(ipRange.networkAddress);

        const subnets: string[] = [];

        for (let i = 0; i < numSubnets; i++) {
            const subnetCIDR = intToIp(baseIpInt) + "/" + bitsToMask;
            subnets.push(subnetCIDR);
            baseIpInt += subnetSize;
        }

        return subnets;
    } catch (error) {
        return error as Error;
    }
}


deploy()
