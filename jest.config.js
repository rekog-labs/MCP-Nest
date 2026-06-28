module.exports = {
  preset: 'ts-jest',
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  // Ignore the vendored old-repo clone (it has its own, unrelated test suite).
  // TODO: Remove this
  testPathIgnorePatterns: ['/node_modules/', '/old-repo/'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};
