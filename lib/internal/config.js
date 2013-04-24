var _ = require("underscore");
var fs = require("fs");
var crypto = require("crypto");
var os = require("os");
var min = require("jsonminify");

var env = process.env;

var config = loadConfig("config.json");
var publicKey = loadFile("public-key.pem");
var privateKey = loadFile("private-key.pem");

module.exports = function (mode) {

  var globalValues = replaceAll(config, env);
  var modeValues = replaceAll(config[mode] || config["development"], env);

  function get(values, key, envKey, vars) {
    var value = env[envKey] || values[key] || defaults[key];
    if (vars && _.isString(value)) value = replaceStr(value, vars);
    return value;
  }

  return {

    // @todo add globalValues accessors

    port: function () {
      return get(modeValues, "port", "PORT");
    },

    localBaseUrl: function () {
      return get(modeValues, "localBaseUrl", "AP3_LOCAL_BASE_URL", {port: this.port()});
    },

    store: function () {
      return modeValues["store"] || defaults["store"];
    },

    hosts: function () {
      return get(modeValues, "hosts");
    },

    publicKey: function () {
      return get(modeValues, null, "AP3_PUBLIC_KEY") || publicKey;
    },

    privateKey: function () {
      return get(modeValues, null, "AP3_PRIVATE_KEY") || privateKey;
    },

    secret: function () {
      return crypto.createHash("sha1").update(this.privateKey()).digest("base64");
    }

  };

};

var defaults = {
  // @todo add globalValues defaults
  port: 3000,
  localBaseUrl: "http://" + os.hostname() + ":$port",
  store: "memory",
  hosts: [
    "http://admin:admin@localhost:1990/confluence",
    "http://admin:admin@localhost:2990/jira",
    "http://admin:admin@localhost:5990/refapp"
  ]
};

function replaceAll(settings, values) {
  Object.keys(settings, function (k) {
    var setting = settings[k];
    if (_.isString(setting)) {
      settings[k] = replaceStr(setting, values);
    }
    else if (_.isObject(setting)) {
      replaceAll(setting);
    }
  });
  return settings;
}

function replaceStr(setting, values) {
  return setting.replace(/\$([a-zA-Z]\w*)/g, function ($0, $1) {
    return values[$1] || $0;
  });
}

function loadFile(path) {
  return fs.existsSync(path) ? fs.readFileSync(path).toString() : null;
}

function loadConfig(path) {
  var data = loadFile(path);
  return data ? JSON.parse(min(data)) : {};
}