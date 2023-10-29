import { SSTConfig } from "sst";
import { DefaultServiceStack } from "./stacks/DefaultServiceStack";

export default {
  config(_input) {
    return {
      name: `${process.env.APP_NAME}`,
      region: process.env.AWS_REGION || "ap-southeast-2",
      stage: process.env.APP_ENV || "dev",
    };
  },
  stacks(app) {
    app.stack(DefaultServiceStack);
  },
} satisfies SSTConfig;
