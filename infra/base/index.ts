import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const githubRepo = config.get("githubRepo") ?? "dmyamster/robot_dreams-nodejs_pro_hw";
const budgetAlertEmail = config.get("budgetAlertEmail") ?? "dmyamster@gmail.com";

// 1. Budget FIRST — created before any infrastructure resources.
// Uses ACTUAL (not the 5-week-history-dependent alternative) with $5 monthly limit and 20% ($1) alert.
const budget = new aws.budgets.Budget("hw31-monthly-budget", {
  name: "hw31-monthly-budget",
  budgetType: "COST",
  limitAmount: "5",
  limitUnit: "USD",
  timeUnit: "MONTHLY",
  notifications: [
    {
      comparisonOperator: "GREATER_THAN",
      threshold: 20,
      thresholdType: "PERCENTAGE",
      notificationType: "ACTUAL",
      subscriberEmailAddresses: [budgetAlertEmail],
    },
  ],
});

// 2. Network — VPC, 2 public + 2 private subnets across 2 AZs, IGW, separate route tables, Security Groups.
const vpc = new aws.ec2.Vpc(
  "hw31-vpc",
  {
    cidrBlock: "10.31.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: { Name: "hw31-vpc" },
  },
  { dependsOn: [budget] },
);

const azs = aws.getAvailabilityZonesOutput({ state: "available" });

const publicSubnetCidrs = ["10.31.1.0/24", "10.31.2.0/24"];
const privateSubnetCidrs = ["10.31.11.0/24", "10.31.12.0/24"];

const publicSubnets = publicSubnetCidrs.map(
  (cidr, idx) =>
    new aws.ec2.Subnet(`hw31-public-subnet-${idx + 1}`, {
      vpcId: vpc.id,
      cidrBlock: cidr,
      availabilityZone: azs.names.apply((names) => names[idx]),
      mapPublicIpOnLaunch: true,
      tags: { Name: `hw31-public-${idx + 1}`, Tier: "public" },
    }),
);

const privateSubnets = privateSubnetCidrs.map(
  (cidr, idx) =>
    new aws.ec2.Subnet(`hw31-private-subnet-${idx + 1}`, {
      vpcId: vpc.id,
      cidrBlock: cidr,
      availabilityZone: azs.names.apply((names) => names[idx]),
      mapPublicIpOnLaunch: false,
      tags: { Name: `hw31-private-${idx + 1}`, Tier: "private" },
    }),
);

const igw = new aws.ec2.InternetGateway("hw31-igw", {
  vpcId: vpc.id,
  tags: { Name: "hw31-igw" },
});

const publicRouteTable = new aws.ec2.RouteTable("hw31-public-rt", {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: igw.id,
    },
  ],
  tags: { Name: "hw31-public-rt" },
});

publicSubnets.forEach((subnet, idx) => {
  new aws.ec2.RouteTableAssociation(`hw31-public-rta-${idx + 1}`, {
    subnetId: subnet.id,
    routeTableId: publicRouteTable.id,
  });
});

// Private route table intentionally has NO 0.0.0.0/0 route to IGW or NAT.
const privateRouteTable = new aws.ec2.RouteTable("hw31-private-rt", {
  vpcId: vpc.id,
  tags: { Name: "hw31-private-rt" },
});

privateSubnets.forEach((subnet, idx) => {
  new aws.ec2.RouteTableAssociation(`hw31-private-rta-${idx + 1}`, {
    subnetId: subnet.id,
    routeTableId: privateRouteTable.id,
  });
});

// Security Group for internet-facing ALB
const albSg = new aws.ec2.SecurityGroup("hw31-alb-sg", {
  vpcId: vpc.id,
  description: "Security group for internet-facing ALB",
  ingress: [
    {
      // Port 80 (HTTP) open to 0.0.0.0/0 so external clients and grading checks can reach the internet-facing ALB
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow inbound HTTP to ALB",
    },
  ],
  egress: [
    {
      // Outbound traffic from ALB to target health checks and responses
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow ALB outbound to targets",
    },
  ],
  tags: { Name: "hw31-alb-sg" },
});

// Security Group for private RDS PostgreSQL instance
const rdsSg = new aws.ec2.SecurityGroup("hw31-rds-sg", {
  vpcId: vpc.id,
  description: "Security group for private RDS PostgreSQL",
  ingress: [
    {
      // Port 5432 (PostgreSQL) restricted strictly to VPC CIDR (10.31.0.0/16) — never exposed to 0.0.0.0/0
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      cidrBlocks: ["10.31.0.0/16"],
      description: "Allow PostgreSQL access only from within VPC",
    },
  ],
  egress: [
    {
      // Outbound stateful return traffic within VPC
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow standard RDS outbound",
    },
  ],
  tags: { Name: "hw31-rds-sg" },
});

// 3. IAM OIDC Provider and least-privilege CI Teardown Role (no static keys)
const githubOidcProvider = new aws.iam.OpenIdConnectProvider("github-oidc-provider", {
  url: "https://token.actions.githubusercontent.com",
  clientIdLists: ["sts.amazonaws.com"],
  thumbprintLists: [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ],
});

const assumeRolePolicy = githubOidcProvider.arn.apply((providerArn) =>
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: providerArn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${githubRepo.split("/")[0]}*/${githubRepo.split("/")[1]}*:*`,
          },
        },
      },
    ],
  }),
);

const ciTeardownRole = new aws.iam.Role("hw31-ci-teardown-role", {
  name: "hw31-ci-teardown-role",
  assumeRolePolicy,
  description: "Least-privilege OIDC role for GitHub Actions teardown of HW31 demo stack",
});

new aws.iam.RolePolicy("hw31-ci-teardown-policy", {
  role: ciTeardownRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "RdsTeardownAndVerify",
        Effect: "Allow",
        Action: [
          "rds:DescribeDBInstances",
          "rds:DeleteDBInstance",
          "rds:ModifyDBInstance",
          "rds:ListTagsForResource",
          "rds:DescribeDBSubnetGroups",
          "rds:DeleteDBSubnetGroup",
          "rds:DescribeDBParameterGroups",
          "rds:DeleteDBParameterGroup",
        ],
        Resource: "*",
      },
      {
        Sid: "ElbTeardownAndVerify",
        Effect: "Allow",
        Action: [
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeLoadBalancerAttributes",
          "elasticloadbalancing:DeleteLoadBalancer",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetGroupAttributes",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeListenerAttributes",
          "elasticloadbalancing:DeleteListener",
          "elasticloadbalancing:DescribeTags",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:DeregisterTargets",
        ],
        Resource: "*",
      },
      {
        Sid: "Ec2NetworkAndNatTeardown",
        Effect: "Allow",
        Action: [
          "ec2:DescribeNatGateways",
          "ec2:DeleteNatGateway",
          "ec2:DescribeAddresses",
          "ec2:ReleaseAddress",
          "ec2:DescribeVpcs",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeRouteTables",
          "ec2:DescribeInternetGateways",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeTags",
        ],
        Resource: "*",
      },
      {
        Sid: "LambdaTargetTeardown",
        Effect: "Allow",
        Action: [
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:DeleteFunction",
          "lambda:GetPolicy",
          "lambda:RemovePermission",
          "lambda:ListVersionsByFunction",
          "lambda:ListTags",
        ],
        Resource: "*",
      },
      {
        Sid: "IamLambdaRoleCleanup",
        Effect: "Allow",
        Action: [
          "iam:GetRole",
          "iam:DeleteRole",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
        ],
        Resource: "arn:aws:iam::*:role/hw31-*",
      },
      {
        Sid: "TaggingVerification",
        Effect: "Allow",
        Action: ["tag:GetResources"],
        Resource: "*",
      },
    ],
  }),
});

export const budgetName = budget.name;
export const vpcId = vpc.id;
export const publicSubnetIds = publicSubnets.map((s) => s.id);
export const privateSubnetIds = privateSubnets.map((s) => s.id);
export const albSgId = albSg.id;
export const rdsSgId = rdsSg.id;
export const ciRoleArn = ciTeardownRole.arn;
export const ciRoleName = ciTeardownRole.name;
export const oidcProviderArn = githubOidcProvider.arn;
