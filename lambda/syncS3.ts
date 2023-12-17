import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { Context, APIGatewayProxyResult, EventBridgeEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

async function uploadDir(localPath: string) {
    const bucketName = process.env.BUCKET_NAME;
    const s3Path = process.env.S3_PATH as string;
    const client = new S3Client({ region: process.env.REGION });

    async function getFiles(dir: string): Promise<string | string[]> {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(
            dirents.map((dirent) => {
                const res = path.resolve(dir, dirent.name);
                return dirent.isDirectory() ? getFiles(res) : res;
            })
        );
        return Array.prototype.concat(...files);
    }

    const files = (await getFiles(localPath)) as string[];
    const uploads = files.map((filePath) =>
        client.send(new PutObjectCommand({
            Key: path.resolve(s3Path, path.relative(localPath, filePath)),
            Bucket: bucketName,
            Body: createReadStream(filePath),
        }))
    );
    return Promise.all(uploads);
}

export const handler = async (event: EventBridgeEvent<any, any>, context: Context): Promise<APIGatewayProxyResult | undefined> => {

    const localPath = process.env.EFS_MOUNTED_FOLDER as string;
    console.log(`Syncing from EFS [${localPath}] to S3 folder ${process.env.S3_PATH}`)
    await uploadDir(localPath);
    console.log("Sync S3 completed!")

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Success!',
        }),
    };
}