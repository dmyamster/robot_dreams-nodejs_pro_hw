#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-eu-north-1}"
mkdir -p "$ROOT/evidence"

# 1. Export base stack state
pulumi --cwd "$ROOT/infra/base" stack export > "$ROOT/evidence/base-state.json"

# 2. Compute base.txt from AWS + state
VPC_ID="$(pulumi --cwd "$ROOT/infra/base" stack output vpcId)"

PUBLIC_SUBNETS="$(jq -r '[.deployment.resources[]? | select(.type=="aws:ec2/subnet:Subnet" and .outputs.mapPublicIpOnLaunch==true)] | length' "$ROOT/evidence/base-state.json")"
PRIVATE_SUBNETS="$(jq -r '[.deployment.resources[]? | select(.type=="aws:ec2/subnet:Subnet" and .outputs.mapPublicIpOnLaunch==false)] | length' "$ROOT/evidence/base-state.json")"
SUBNET_AZS="$(jq -r '[.deployment.resources[]? | select(.type=="aws:ec2/subnet:Subnet") | .outputs.availabilityZone] | map(select(. != null)) | unique | length' "$ROOT/evidence/base-state.json")"

PRIVATE_RT_ID="$(jq -r '.deployment.resources[]? | select(.type=="aws:ec2/routeTable:RouteTable" and (.outputs.tags.Name // "")=="hw31-private-rt") | .outputs.id' "$ROOT/evidence/base-state.json")"
PRIVATE_DEFAULT_ROUTE="$(aws ec2 describe-route-tables --region "$REGION" --route-table-ids "$PRIVATE_RT_ID" \
  --query 'length(RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`])' --output text)"

SECURITY_GROUPS="$(jq -r '[.deployment.resources[]? | select(.type=="aws:ec2/securityGroup:SecurityGroup")] | length' "$ROOT/evidence/base-state.json")"
TAGGED_RESOURCES="$(aws resourcegroupstaggingapi get-resources --region "$REGION" \
  --tag-filters Key=Project,Values=nodejs-pro-hw31 Key=Stack,Values=base \
  --query 'length(ResourceTagMappingList)' --output text)"

cat > "$ROOT/evidence/base.txt" <<EOF
vpc-id=${VPC_ID}
public-subnets=${PUBLIC_SUBNETS}
private-subnets=${PRIVATE_SUBNETS}
subnet-azs=${SUBNET_AZS}
private-default-route=${PRIVATE_DEFAULT_ROUTE}
security-groups=${SECURITY_GROUPS}
tagged-resources=${TAGGED_RESOURCES}
EOF

# 3. Collect IAM Role trust policy + permission policy (decoded JSON)
ROLE_NAME="$(pulumi --cwd "$ROOT/infra/base" stack output ciRoleName)"
ROLE_ARN="$(pulumi --cwd "$ROOT/infra/base" stack output ciRoleArn)"
POLICY_NAME="$(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[0]' --output text)"

ROLE_JSON="$(aws iam get-role --role-name "$ROLE_NAME" --output json)"
POLICY_JSON="$(aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --output json)"

jq -n --argjson role "$ROLE_JSON" --argjson policy "$POLICY_JSON" '{
  Role: $role.Role,
  PolicyName: $policy.PolicyName,
  PolicyDocument: $policy.PolicyDocument
}' > "$ROOT/evidence/iam.json"

# 4. Run positive and negative IAM policy simulations
SIM_ALLOWED="$(aws iam simulate-principal-policy \
  --policy-source-arn "$ROLE_ARN" \
  --action-names rds:DescribeDBInstances \
  --context-entries "ContextKeyName=aws:RequestedRegion,ContextKeyValues=${REGION},ContextKeyType=string" \
  --query 'EvaluationResults[0].EvalDecision' --output text)"

SIM_DENIED="$(aws iam simulate-principal-policy \
  --policy-source-arn "$ROLE_ARN" \
  --action-names iam:CreateUser \
  --context-entries "ContextKeyName=aws:RequestedRegion,ContextKeyValues=${REGION},ContextKeyType=string" \
  --query 'EvaluationResults[0].EvalDecision' --output text)"

cat > "$ROOT/evidence/iam.txt" <<EOF
sim-allowed=${SIM_ALLOWED}
sim-denied=${SIM_DENIED}
EOF

echo "Base and IAM evidence written to evidence/base.txt, evidence/base-state.json, evidence/iam.json, evidence/iam.txt"
