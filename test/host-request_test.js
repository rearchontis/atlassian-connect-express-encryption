const helper = require("./test_helper");
const mocks = require("./mocks");
const config = require("../lib/internal/config");
const HostRequest = require("../lib/internal/host-request");
const nock = require("nock");
const should = require("should");
const jwt = require("atlassian-jwt");
const extend = require("extend");
const _ = require("lodash");

describe("Host Request", function() {
  const clientSettings = {
    clientKey: "test-client-key",
    oauthClientId: "oauth-client-id",
    sharedSecret: "shared-secret",
    baseUrl: "https://test.atlassian.net"
  };

  const createAddonConfig = function(opts) {
    // eslint-disable-next-line mocha/no-setup-in-describe
    opts = extend(
      {
        jwt: {
          validityInMinutes: 3
        }
      },
      opts
    );

    // eslint-disable-next-line mocha/no-setup-in-describe
    return config({}, "development", {
      development: opts
    });
  };

  const mockAddon = function(addonConfig) {
    if (!addonConfig) {
      addonConfig = {};
    }

    return {
      // eslint-disable-next-line mocha/no-setup-in-describe
      logger: require("./logger"),
      key: "test-addon-key",
      // eslint-disable-next-line mocha/no-setup-in-describe
      config: createAddonConfig(addonConfig),
      descriptor: {
        scopes: ["READ", "WRITE"]
      },
      // eslint-disable-next-line mocha/no-setup-in-describe
      settings: mocks.store(clientSettings, clientSettings.clientKey)
    };
  };

  function getHttpClient(addonConfig, context) {
    if (arguments.length === 0) {
      addonConfig = context = {};
    } else if (arguments.length === 1) {
      context = addonConfig;
      addonConfig = {};
    }

    const a = mockAddon(addonConfig);
    return new HostRequest(a, context, clientSettings.clientKey);
  }

  function interceptRequest(testCallback, replyCallback, options) {
    const opts = extend(
      {
        baseUrl: clientSettings.baseUrl,
        method: "get",
        path: "/some/path/on/host",
        httpClientContext: {}
      },
      options || {}
    );

    if (!opts.requestPath) {
      opts.requestPath = opts.path;
    }
    if (!opts.uri) {
      opts.uri = opts.requestPath;
    }

    let interceptor = nock(opts.baseUrl)[opts.method](opts.path);

    if (opts.qs) {
      interceptor = interceptor.query(opts.qs);
    }
    interceptor = interceptor.reply(replyCallback);

    let httpClient = getHttpClient(opts.addonConfig, opts.httpClientContext);

    if (opts.httpClientWrapper) {
      httpClient = opts.httpClientWrapper(httpClient);
    }

    const httpClientOpts = _.cloneDeep(opts);
    delete httpClientOpts.baseUrl;
    delete httpClientOpts.method;
    delete httpClientOpts.path;
    delete httpClientOpts.requestPath;
    delete httpClientOpts.httpClientContext;

    httpClient[opts.method](httpClientOpts, function() {
      interceptor.done(); // will throw assertion if endpoint is not intercepted
      testCallback();
    });
  }

  function interceptRequestAsUser(testCallback, replyCallback, options) {
    const userKey = options.userKey;
    delete options.userKey;
    const opts = extend({}, options, {
      httpClientWrapper: function(httpClient) {
        return httpClient.asUser(userKey);
      }
    });
    interceptRequest(testCallback, replyCallback, opts);
  }

  function interceptRequestAsUserByAccountId(
    testCallback,
    replyCallback,
    options
  ) {
    const userAccountId = options.userAccountId;
    delete options.userAccountId;
    const opts = extend({}, options, {
      httpClientWrapper: function(httpClient) {
        return httpClient.asUserByAccountId(userAccountId);
      }
    });
    interceptRequest(testCallback, replyCallback, opts);
  }

  it("constructs non-null get request", function(done) {
    interceptRequest(done, 200);
  });

  describe("Headers", function() {
    it("get request has headers", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(done, function(uri, requestBody) {
        should.exist(this.req.headers);
      });
    });

    it("get request has user-agent header", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(done, function(uri, requestBody) {
        this.req.headers["user-agent"].should.startWith(
          "atlassian-connect-express/"
        );
      });
    });

    it("get request has user-agent version set to package version", function(done) {
      const aceVersion = require("../package.json").version;
      // eslint-disable-next-line no-unused-vars
      interceptRequest(done, function(uri, requestBody) {
        this.req.headers["user-agent"].should.startWith(
          "atlassian-connect-express/" + aceVersion
        );
      });
    });

    it("get request has custom user-agent", function(done) {
      const userAgent = "my-fun-app";
      const opts = {
        addonConfig: {
          userAgent: userAgent
        }
      };
      // eslint-disable-next-line no-unused-vars
      interceptRequest(
        done,
        // eslint-disable-next-line no-unused-vars
        function(uri, requestBody) {
          this.req.headers["user-agent"].should.equal(userAgent);
        },
        opts
      );
    });

    it("post request preserves custom header", function(done) {
      const interceptor = nock(clientSettings.baseUrl)
        .post("/some/path")
        // eslint-disable-next-line no-unused-vars
        .reply(function(uri, requestBody) {
          this.req.headers.custom_header.should.eql("arbitrary value");
        });

      getHttpClient().post(
        {
          url: "/some/path",
          headers: {
            custom_header: "arbitrary value"
          }
          // eslint-disable-next-line no-unused-vars
        },
        function() {
          interceptor.done();
          done();
        }
      );
    });
  });

  describe("Add-on JWT authentication", function() {
    it("get request has Authorization header", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(done, function(uri, requestBody) {
        should.exist(this.req.headers.authorization);
      });
    });

    it("bitbucket request sets sub claim as clientKey", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(
        done,
        function() {
          const jwtToken = this.req.headers.authorization.slice(4);
          const clientKey = clientSettings.clientKey;
          const decoded = jwt.decode(jwtToken, clientKey, true);
          decoded.sub.should.eql(clientKey);
        },
        {
          addonConfig: {
            product: "bitbucket"
          }
        }
      );
    });

    it('get request has Authorization header starting with "JWT "', function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(done, function(uri, requestBody) {
        this.req.headers.authorization.should.startWith("JWT ");
      });
    });

    it("get request has correct JWT qsh for encoded parameter", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(
        done,
        function() {
          const jwtToken = this.req.headers.authorization.slice(4);
          const decoded = jwt.decode(jwtToken, clientSettings.clientKey, true);
          const expectedQsh = jwt.createQueryStringHash(
            jwt.fromExpressRequest({
              method: "GET",
              path: "/some/path/on/host",
              query: { q: "~ text" }
            }),
            false,
            helper.productBaseUrl
          );
          decoded.qsh.should.eql(expectedQsh);
        },
        { path: "/some/path/on/host?q=~%20text" }
      );
    });

    it("get request has correct JWT qsh for encoded parameter passed via qs field", function(done) {
      const query = { q: "~ text" };
      // eslint-disable-next-line no-unused-vars
      interceptRequest(
        done,
        function() {
          const jwtToken = this.req.headers.authorization.slice(4);
          const decoded = jwt.decode(jwtToken, clientSettings.clientKey, true);
          const expectedQsh = jwt.createQueryStringHash(
            jwt.fromExpressRequest({
              method: "GET",
              path: "/some/path/on/host",
              query: query
            }),
            false,
            helper.productBaseUrl
          );
          decoded.qsh.should.eql(expectedQsh);
        },
        { path: "/some/path/on/host", qs: query }
      );
    });

    it("get request for absolute url on host has Authorization header", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(
        done,
        function() {
          this.req.headers.authorization.should.startWith("JWT ");
        },
        { requestPath: "https://test.atlassian.net/some/path/on/host" }
      );
    });

    it("post request has correct url", function(done) {
      // eslint-disable-next-line no-unused-vars
      interceptRequest(
        done,
        function() {
          this.req.headers.authorization.should.startWith("JWT ");
        },
        { method: "post" }
      );
    });
  });

  describe("User impersonation requests", function() {
    it("Request as user does not add JWT authorization header", function(done) {
      const authServiceMock = mocks.oauth2.service();
      // eslint-disable-next-line no-unused-vars
      interceptRequestAsUser(
        done,
        function() {
          authServiceMock.done();
          this.req.headers.authorization.should.not.startWith("JWT");
        },
        { userKey: "sruiz" }
      );
    });

    it("Request as user adds a Bearer authorization header", function(done) {
      const authServiceMock = mocks.oauth2.service();
      // eslint-disable-next-line no-unused-vars
      interceptRequestAsUser(
        done,
        function() {
          authServiceMock.done();
          this.req.headers.authorization.should.startWith("Bearer");
        },
        { userKey: "sruiz" }
      );
    });

    it("Request as user adds a Bearer authorization header when using account id", function(done) {
      const authServiceMock = mocks.oauth2.service();
      // eslint-disable-next-line no-unused-vars
      interceptRequestAsUserByAccountId(
        done,
        function() {
          authServiceMock.done();
          this.req.headers.authorization.should.startWith("Bearer");
        },
        { userAccountId: "048abaf9-04ea-44d1-acb9-b37de6cc5d2f" }
      );
    });
  });

  describe("Form requests", function() {
    it("post request with form sets form data", function(done) {
      // eslint-disable-next-line no-unused-vars
      const interceptor = nock(clientSettings.baseUrl)
        .post("/some/path")
        .reply(200);

      getHttpClient()
        .post({
          url: "/some/path",
          file: [
            "file content",
            {
              filename: "filename",
              ContentType: "text/plain"
            }
          ]
        })
        .then(function(request) {
          request.file.should.eql([
            "file content",
            { filename: "filename", ContentType: "text/plain" }
          ]);
          done();
        });
    });

    it("post requests using multipartFormData have the right format", function(done) {
      // eslint-disable-next-line no-unused-vars
      const interceptor = nock(clientSettings.baseUrl)
        .post("/some/path")
        .reply(200);

      const someData = "some data";
      getHttpClient()
        .post({
          url: "/some/path",
          multipartFormData: {
            file: [someData, { filename: "myattachmentagain.png" }]
          }
        })
        .then(function(request) {
          request._form.should.be.ok();
          request._form._valueLength.should.eql(someData.length);
          done();
        });
    });

    it("post requests using the deprecated form parameter still have the right format", function(done) {
      // eslint-disable-next-line no-unused-vars
      const interceptor = nock(clientSettings.baseUrl)
        .post("/some/path")
        .reply(200);

      const someData = "some data";
      getHttpClient()
        .post({
          url: "/some/path",
          form: {
            file: [someData, { filename: "myattachmentagain.png" }]
          }
        })
        .then(
          function(request) {
            request._form.should.be.ok();
            request._form._valueLength.should.eql(someData.length);
            done();
          },
          function(err) {
            console.log(err);
          }
        );
    });

    it("post requests using urlEncodedFormData have the right format", function(done) {
      // eslint-disable-next-line no-unused-vars
      const interceptor = nock(clientSettings.baseUrl)
        .post("/some/path")
        .reply(200);

      getHttpClient()
        .post({
          url: "/some/path",
          urlEncodedFormData: {
            param1: "value1"
          }
        })
        .then(function(request) {
          request.body.toString().should.eql("param1=value1");
          done();
        });
    });

    it("post request with undefined clientKey returns promise reject", function(done) {
      // eslint-disable-next-line no-unused-vars
      const interceptor = nock(clientSettings.baseUrl)
        .post("/some/path")
        .reply(200);

      new HostRequest(mockAddon({}), {}, undefined)
        .post({
          url: "/some/path",
          urlEncodedFormData: {
            param1: "value1"
          }
        })
        .then(
          function() {
            // Promise is resolved
            done(new Error("Promise should not be resolved"));
          },
          // eslint-disable-next-line no-unused-vars
          function(reason) {
            // Promise is rejected
            done();
          }
        );
    });
  });
});
