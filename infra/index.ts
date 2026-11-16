import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

const REQUIRED_SECRETS = [
  'DB_PASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'REFRESH_TOKEN_PEPPER',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
] as const;

function requireSecretEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === '') {
    throw new Error(
      `Missing required secret environment variable "${name}". Provide it via scripts/with-secrets.sh or export ${name}=...`,
    );
  }
  return val;
}

// Validate all vault secrets first before creating any Kubernetes resources
const secretValues: Record<string, string> = {};
for (const key of REQUIRED_SECRETS) {
  secretValues[key] = requireSecretEnv(key);
}

const config = new pulumi.Config();
const namespaceName = config.get('namespace') ?? 'broker-hw28';
const imageName = process.env.APP_IMAGE ?? config.get('image') ?? 'broker-api:hw28';
const replicas = Number(config.get('replicas') ?? '2');
const profile = (process.env.DEPLOY_PROFILE ?? config.get('profile') ?? 'hardened') as
  | 'hardened'
  | 'broken';
const rev = process.env.REV ?? config.get('rev') ?? '1';

const isHardened = profile === 'hardened';

const appLabels = { app: 'broker-api' };

const ns = new k8s.core.v1.Namespace('broker-namespace', {
  metadata: {
    name: namespaceName,
  },
});

const encodedSecretData: Record<string, string> = {};
for (const [key, val] of Object.entries(secretValues)) {
  encodedSecretData[key] = Buffer.from(val, 'utf8').toString('base64');
}

// Use `data` (base64) instead of `stringData` so `pulumi up` remains idempotent
const appSecret = new k8s.core.v1.Secret('broker-secrets', {
  metadata: {
    name: 'broker-secrets',
    namespace: ns.metadata.name,
  },
  type: 'Opaque',
  data: encodedSecretData,
});

const deploymentStrategy: k8s.types.input.apps.v1.DeploymentStrategy = isHardened
  ? {
      type: 'RollingUpdate',
      rollingUpdate: {
        maxUnavailable: 0,
        maxSurge: 1,
      },
    }
  : {
      type: 'RollingUpdate',
      rollingUpdate: {
        maxUnavailable: 1,
        maxSurge: 0,
      },
    };

const containerSpec: k8s.types.input.core.v1.Container = {
  name: 'broker-api',
  image: imageName,
  imagePullPolicy: 'IfNotPresent',
  ports: [{ name: 'http', containerPort: 3000 }],
  envFrom: [
    {
      secretRef: {
        name: appSecret.metadata.name,
      },
    },
  ],
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: '3000' },
    { name: 'STARTUP_WARMUP_MS', value: '4000' },
    { name: 'DRAIN_DELAY_MS', value: isHardened ? '5000' : '0' },
    { name: 'REV', value: rev },
  ],
  resources: {
    requests: {
      cpu: '50m',
      memory: '128Mi',
    },
    limits: {
      cpu: '250m',
      memory: '256Mi',
    },
  },
  ...(isHardened
    ? {
        readinessProbe: {
          httpGet: {
            path: '/readyz',
            port: 3000,
          },
          initialDelaySeconds: 1,
          periodSeconds: 1,
          failureThreshold: 1,
          timeoutSeconds: 1,
        },
        livenessProbe: {
          httpGet: {
            path: '/healthz',
            port: 3000,
          },
          initialDelaySeconds: 10,
          periodSeconds: 5,
          failureThreshold: 3,
          timeoutSeconds: 1,
        },
      }
    : {}),
};

const deployment = new k8s.apps.v1.Deployment('broker-api', {
  metadata: {
    name: 'broker-api',
    namespace: ns.metadata.name,
    labels: appLabels,
  },
  spec: {
    replicas,
    strategy: deploymentStrategy,
    selector: {
      matchLabels: appLabels,
    },
    template: {
      metadata: {
        labels: appLabels,
      },
      spec: {
        terminationGracePeriodSeconds: isHardened ? 15 : 3,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 65532,
          runAsGroup: 65532,
        },
        containers: [containerSpec],
      },
    },
  },
});

const service = new k8s.core.v1.Service('broker-api-svc', {
  metadata: {
    name: 'broker-api',
    namespace: ns.metadata.name,
    labels: appLabels,
  },
  spec: {
    type: 'NodePort',
    selector: appLabels,
    ports: [
      {
        name: 'http',
        port: 80,
        targetPort: 3000,
        nodePort: 30080,
      },
    ],
  },
});

const pdb = new k8s.policy.v1.PodDisruptionBudget('broker-pdb', {
  metadata: {
    name: 'broker-pdb',
    namespace: ns.metadata.name,
  },
  spec: {
    minAvailable: 1,
    selector: {
      matchLabels: appLabels,
    },
  },
});

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler('broker-hpa', {
  metadata: {
    name: 'broker-hpa',
    namespace: ns.metadata.name,
  },
  spec: {
    scaleTargetRef: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      name: deployment.metadata.name,
    },
    minReplicas: 2,
    maxReplicas: 4,
    metrics: [
      {
        type: 'Resource',
        resource: {
          name: 'cpu',
          target: {
            type: 'Utilization',
            averageUtilization: 70,
          },
        },
      },
    ],
  },
});

export const namespace = ns.metadata.name;
export const deploymentName = deployment.metadata.name;
export const serviceName = service.metadata.name;
export const pdbName = pdb.metadata.name;
export const hpaName = hpa.metadata.name;
