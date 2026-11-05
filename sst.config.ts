/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'anki-duo',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
      providers: { aws: { region: 'ap-southeast-1' }, cloudflare: true },
    };
  },
  async run() {
    const secrets = {
      databaseUrl: new sst.Secret('DatabaseUrl'),
      betterAuthSecret: new sst.Secret('BetterAuthSecret'),
      originSecret: new sst.Secret('OriginSecret'),
      r2AccessKeyId: new sst.Secret('R2AccessKeyId'),
      r2SecretAccessKey: new sst.Secret('R2SecretAccessKey'),
      r2Bucket: new sst.Secret('R2Bucket'),
      r2Endpoint: new sst.Secret('R2Endpoint'),
      resendApiKey: new sst.Secret('ResendApiKey'),
      googleClientId: new sst.Secret('GoogleClientId'),
      googleClientSecret: new sst.Secret('GoogleClientSecret'),
    };

    const api = new sst.aws.Function('Api', {
      handler: 'apps/api/src/lambda.handler',
      runtime: 'nodejs22.x',
      architecture: 'arm64',
      memory: '512 MB',
      timeout: '15 seconds',
      url: { authorization: 'none' },
      logging: { retention: '2 weeks' },
      link: Object.values(secrets),
      environment: {
        DATABASE_URL: secrets.databaseUrl.value,
        BETTER_AUTH_SECRET: secrets.betterAuthSecret.value,
        ORIGIN_SECRET: secrets.originSecret.value,
        R2_ACCESS_KEY_ID: secrets.r2AccessKeyId.value,
        R2_SECRET_ACCESS_KEY: secrets.r2SecretAccessKey.value,
        R2_BUCKET: secrets.r2Bucket.value,
        R2_ENDPOINT: secrets.r2Endpoint.value,
        RESEND_API_KEY: secrets.resendApiKey.value,
        GOOGLE_CLIENT_ID: secrets.googleClientId.value,
        GOOGLE_CLIENT_SECRET: secrets.googleClientSecret.value,
      },
    });

    // Edge: static assets from apps/web/dist, /api/* proxied to the Lambda Function URL.
    const edge = new sst.cloudflare.Worker('Edge', {
      handler: 'apps/edge/src/index.ts',
      assets: { directory: 'apps/web/dist' },
      environment: {
        LAMBDA_URL: api.url,
        ORIGIN_SECRET: secrets.originSecret.value,
      },
    });

    new aws.budgets.Budget('MonthlyBudget', {
      budgetType: 'COST',
      limitAmount: '1',
      limitUnit: 'USD',
      timeUnit: 'MONTHLY',
      notifications: [
        {
          comparisonOperator: 'GREATER_THAN',
          threshold: 100,
          thresholdType: 'PERCENTAGE',
          notificationType: 'ACTUAL',
          subscriberEmailAddresses: [process.env.BUDGET_ALERT_EMAIL ?? 'owner@example.com'],
        },
      ],
    });

    return { api: api.url, edge: edge.url };
  },
});
