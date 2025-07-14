module.exports = {
  preset: 'ts-jest',
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};
