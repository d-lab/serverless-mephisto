import {Context, APIGatewayProxyResult, EventBridgeEvent} from 'aws-lambda';
import {ECSClient, ListTagsForResourceCommand} from "@aws-sdk/client-ecs";
import {EC2Client, DescribeNetworkInterfacesCommand} from "@aws-sdk/client-ec2";
import {Route53Client, ChangeResourceRecordSetsCommand, Change} from "@aws-sdk/client-route-53";

const ecs = new ECSClient({region: 'ap-southeast-2'});
const ec2 = new EC2Client({region: 'ap-southeast-2'});
const route53 = new Route53Client({region: 'ap-southeast-2'});

const HOSTED_ZONE_ID = process.env.HOSTED_ZONE_ID || 'Z00474913K5RW477VIOAN';

export const handler = async (event: EventBridgeEvent<any, any>, context: Context): Promise<APIGatewayProxyResult | undefined> => {
    // console.log(`Event: ${JSON.stringify(event, null, 2)}`);

    const task = event.detail;
    const clusterArn = task.clusterArn;
    console.log(`clusterArn: ${clusterArn}`);

    const clusterName = clusterArn.split(':cluster/')[1];

    const eniId = getEniId(task);
    if (!eniId) {
        console.log('Network interface not found');
        return;
    }

    const taskPublicIp = await fetchEniPublicIp(eniId);
    if (taskPublicIp.length === 0) {
        console.log('Public IP not found');
        return;
    }
    const serviceName = task.group.split(":")[1];
    console.log(`task:${serviceName} public-id: ${taskPublicIp}`);

    const containerDomain = `${process.env.APP_NAME}.${process.env.DOMAIN}`;
    let recordSet = createRecordSet(containerDomain, taskPublicIp);
    if (event.detail.lastStatus === 'RUNNING' && event.detail.desiredStatus === 'STOPPED') {
        console.log(`Deleting DNS record for ${containerDomain} (${taskPublicIp})`);
        recordSet = deleteRecordSet(containerDomain, taskPublicIp);
    }

    await updateDnsRecord(clusterName, HOSTED_ZONE_ID, recordSet);
    console.log(`DNS record update finished for ${containerDomain} (${taskPublicIp})`);

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Success!',
        }),
    };
};

const getEniId = (task: any) => {
    return task.attachments
        .filter((attachment: any) => attachment.type === 'eni')
        .map((eniAttachment: any) =>
            eniAttachment.details
                .filter((details: any) => details.name === 'networkInterfaceId')
                .map((details: any) => details.value)[0]
        )[0];
}

const fetchEniPublicIp = async (eniId: string) => {
    const command = new DescribeNetworkInterfacesCommand({
        NetworkInterfaceIds: [eniId],
    });
    const response = await ec2.send(command);
    return response.NetworkInterfaces?.[0].Association?.PublicIp || '';
}

const createRecordSet = (domain: string, publicIp: string) => {
    return {
        Action: 'UPSERT',
        ResourceRecordSet: {
            Name: domain,
            Type: 'A',
            TTL: 180,
            ResourceRecords: [
                {
                    Value: publicIp,
                },
            ],
        },
    } as Change;
}

const deleteRecordSet = (domain: string, publicIp: string) => {
    return {
        Action: 'DELETE',
        ResourceRecordSet: {
            Name: domain,
            Type: 'A',
            TTL: 180,
            ResourceRecords: [
                {
                    Value: publicIp,
                },
            ],
        },
    } as Change;
}


const updateDnsRecord = async (clusterName: string, hostedZoneId: string, changeRecordSet: any) => {
    const command = new ChangeResourceRecordSetsCommand({
        ChangeBatch: {
            Comment: `Auto generated Record for ECS Fargate cluster ${clusterName}`,
            Changes: [changeRecordSet],
        },
        HostedZoneId: hostedZoneId,
    });
    const updateResult = await route53.send(command);
    console.log('updateResult: %j', updateResult);
}