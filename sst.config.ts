import { SSTConfig } from "sst";
import { DefaultServiceStack } from "./stacks/DefaultServiceStack";

export default {
  config(_input) {
    return {
      name: `serverless-${process.env.APP_NAME}-${process.env.APP_ENV}`,
      region: process.env.AWS_REGION || "ap-southeast-2"
    };
  },
  stacks(app) {
    app.stack(DefaultServiceStack);
  },
} satisfies SSTConfig;
