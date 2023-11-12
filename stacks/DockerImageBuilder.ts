import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecrdeploy from 'cdk-ecr-deployment';
import { Construct } from 'constructs';
import * as subProcess from 'child_process';

export default class DockerImageBuilder {
    private name: string;
    private path: string;
    private stack: Construct;
    private image: DockerImageAsset;
    private buildArgs: {
        [key: string]: string;
    };

    constructor() {
        this.name = 'unnamed';
        this.path = '';
        this.image = undefined as unknown as DockerImageAsset;
        this.buildArgs = {};
        this.stack = undefined as unknown as Construct;
    }

    public withName(name: string): DockerImageBuilder {
        this.name = name;
        return this;
    }

    public withPath(path: string): DockerImageBuilder {
        this.path = path;
        return this;
    }

    public withStack(stack: Construct): DockerImageBuilder {
        this.stack = stack;
        return this;
    }

    public withBuildArgs(buildArgs: { [key: string]: string }): DockerImageBuilder {
        this.buildArgs = buildArgs;
        return this;
    }

    public build(): DockerImageBuilder {
        if (!this.path) {
            throw new Error("Missing path for building Docker image");
        }
        if (!this.name) {
            throw new Error("Missing image tag");
        }
        if (!this.stack) {
            throw new Error("There is no scope to build");
        }

        const image = new DockerImageAsset(this.stack, 'CDKDockerImage', {
            directory: this.path,
            buildArgs: this.buildArgs,
            platform: Platform.LINUX_AMD64,
            // cacheFrom: [{
            //     type: 'gha',
            //     params: {}
            // }],
            // cacheTo: {
            //     type: 'gha',
            //     params: {}
            // }
        });

        const targetImageWithTags = `${this.name}:latest`;

        // new ecrdeploy.ECRDeployment(this.stack, 'DeployDockerImage', {
        //     src: new ecrdeploy.DockerImageName(image.imageUri),
        //     dest: new ecrdeploy.DockerImageName(`${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${targetImageWithTags}`),
        // });

        this.image = image;

        return this;
    }

    public getImage(): DockerImageAsset {
        return this.image;
    }
}