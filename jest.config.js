module.exports = {
  "testEnvironment": "node",
  "collectCoverage": true,
  "testMatch": [
      "**/*.test.ts"
   ],
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "transform": {
    "^.+\\.tsx?$": "ts-jest"
  },
}
