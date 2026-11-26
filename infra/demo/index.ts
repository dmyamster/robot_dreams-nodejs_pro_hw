import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Register transform BEFORE creating any resources so RDS destroy never gets stuck
// on deletionProtection or missing skipFinalSnapshot.
pulumi.runtime.registerResourceTransform((args) =>
  args.type === "aws:rds/instance:Instance"
    ? {
        props: {
          ...args.props,
          deletionProtection: false,
          skipFinalSnapshot: true,
        },
        opts: args.opts,
      }
    : undefined,
);

const config = new pulumi.Config();
const hw31Config = new pulumi.Config("hw31");
const withNat = hw31Config.getBoolean("withNat") ?? false;

const baseStackName =
  config.get("baseStack") ?? `${pulumi.getOrganization()}/hw31-base/base`;
const baseStack = new pulumi.StackReference(baseStackName);

const publicSubnetIds = baseStack.requireOutput("publicSubnetIds") as pulumi.Output<string[]>;
const privateSubnetIds = baseStack.requireOutput("privateSubnetIds") as pulumi.Output<string[]>;
const albSgId = baseStack.requireOutput("albSgId") as pulumi.Output<string>;
const rdsSgId = baseStack.requireOutput("rdsSgId") as pulumi.Output<string>;

const dbPassword =
  config.getSecret("dbPassword") ??
  pulumi.secret(process.env.DB_PASSWORD ?? "super_secret_db_pass_123");

// 1. RDS Multi-AZ instance deployment (db.t4g.micro, PostgreSQL, gp3 20 GiB, encrypted)
const dbSubnetGroup = new aws.rds.SubnetGroup("hw31-db-subnet-group", {
  name: "hw31-db-subnet-group",
  subnetIds: privateSubnetIds,
  tags: { Name: "hw31-db-subnet-group" },
});

const dbInstance = new aws.rds.Instance("hw31-postgres", {
  identifier: "hw31-postgres",
  engine: "postgres",
  engineVersion: "16",
  instanceClass: "db.t4g.micro",
  allocatedStorage: 20,
  storageType: "gp3",
  multiAz: true,
  storageEncrypted: true,
  backupRetentionPeriod: 1,
  dbName: "broker_db",
  username: "postgres",
  password: dbPassword,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [rdsSgId],
  publiclyAccessible: false,
  performanceInsightsEnabled: false,
  deletionProtection: false,
  skipFinalSnapshot: true,
  tags: { Name: "hw31-postgres" },
});

// 2. Internet-facing ALB + Lambda target (adds $0/hr extra compute vs EC2)
const alb = new aws.lb.LoadBalancer("hw31-alb", {
  name: "hw31-alb",
  internal: false,
  loadBalancerType: "application",
  subnets: publicSubnetIds,
  securityGroups: [albSgId],
  tags: { Name: "hw31-alb" },
});

const lambdaRole = new aws.iam.Role("hw31-lambda-role", {
  name: "hw31-lambda-exec-role",
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  }),
});

new aws.iam.RolePolicyAttachment("hw31-lambda-basic-exec", {
  role: lambdaRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});

const healthLambda = new aws.lambda.Function("hw31-health-fn", {
  name: "hw31-health-fn",
  role: lambdaRole.arn,
  runtime: "nodejs22.x",
  handler: "index.handler",
  code: new pulumi.asset.AssetArchive({
    "index.mjs": new pulumi.asset.StringAsset(`
export const handler = async (event) => ({
  statusCode: 200,
  statusDescription: "200 OK",
  isBase64Encoded: false,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "ok",
    service: "paper-trading-broker-api",
    path: event?.path ?? "/"
  }),
});
`),
  }),
});

const targetGroup = new aws.lb.TargetGroup("hw31-alb-tg", {
  name: "hw31-alb-tg",
  targetType: "lambda",
  healthCheck: {
    enabled: true,
    path: "/health",
    matcher: "200",
    interval: 15,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 2,
  },
  tags: { Name: "hw31-alb-tg" },
});

const lambdaPermission = new aws.lambda.Permission("hw31-alb-invoke-lambda", {
  action: "lambda:InvokeFunction",
  function: healthLambda.name,
  principal: "elasticloadbalancing.amazonaws.com",
  sourceArn: targetGroup.arn,
});

new aws.lb.TargetGroupAttachment(
  "hw31-alb-tg-attachment",
  {
    targetGroupArn: targetGroup.arn,
    targetId: healthLambda.arn,
  },
  { dependsOn: [lambdaPermission] },
);

new aws.lb.Listener("hw31-alb-http-listener", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [
    {
      type: "forward",
      targetGroupArn: targetGroup.arn,
    },
  ],
});

// 3. Optional NAT Gateway behind hw31:withNat=true feature flag
let natGatewayId: pulumi.Output<string> | undefined;
if (withNat) {
  const natEip = new aws.ec2.Eip("hw31-nat-eip", {
    domain: "vpc",
    tags: { Name: "hw31-nat-eip" },
  });

  const natGateway = new aws.ec2.NatGateway("hw31-nat", {
    allocationId: natEip.id,
    subnetId: publicSubnetIds.apply((ids) => ids[0]),
    tags: { Name: "hw31-nat" },
  });

  natGatewayId = natGateway.id;
}

export const dbIdentifier = dbInstance.identifier;
export const dbEndpoint = dbInstance.endpoint;
export const dbAvailabilityZone = dbInstance.availabilityZone;
export const albDnsName = alb.dnsName;
export const albArn = alb.arn;
export const targetGroupArn = targetGroup.arn;
export { natGatewayId };
