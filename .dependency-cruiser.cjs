/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies between feature modules are forbidden.',
      from: { path: '^src/', pathNot: ['^src/entities/', '^src/orders/orders\\.repository\\.ts$'] },
      to: { circular: true, pathNot: ['^src/entities/', '^src/orders/orders\\.repository\\.ts$'] },
    },
    {
      name: 'health-isolated',
      severity: 'error',
      comment: 'Health module must not depend on business modules.',
      from: { path: '^src/health/' },
      to: { path: '^src/(orders|files|auth|instruments)/' },
    },
    {
      name: 'instruments-no-orders-or-files',
      severity: 'error',
      comment: 'Instruments module must not depend on orders or files.',
      from: { path: '^src/instruments/' },
      to: { path: '^src/(orders|files)/' },
    },
    {
      name: 'auth-no-orders-or-files',
      severity: 'error',
      comment: 'Auth module must not depend on orders, files, or instruments.',
      from: { path: '^src/auth/' },
      to: { path: '^src/(orders|files|instruments)/' },
    },
    {
      name: 'files-no-orders',
      severity: 'error',
      comment: 'Files module must not depend on orders.',
      from: { path: '^src/files/' },
      to: { path: '^src/orders/' },
    },
    {
      name: 'config-isolated',
      severity: 'error',
      comment: 'Config module must not depend on feature modules.',
      from: { path: '^src/config/' },
      to: { path: '^src/(auth|orders|files|instruments|health)/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
