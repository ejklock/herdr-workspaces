module.exports = {
  "forbidden": [
    {
      "name": "no-cycles",
      "severity": "error",
      "from": {},
      "to": {
        "circular": true
      }
    }
  ],
  "options": {
    "doNotFollow": {
      "path": "node_modules"
    },
    "tsPreCompilationDeps": true,
    "tsConfig": {
      "fileName": "tsconfig.json"
    },
    "exclude": {
      "path": "^(?:mods/editor|mods/my-files|mods/my-diff|mods/my-changes)(?:/|$)"
    }
  }
};
