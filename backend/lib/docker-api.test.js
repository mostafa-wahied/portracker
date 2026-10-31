const { afterEach, beforeEach, describe, expect, jest: jestMock, test } = require("@jest/globals");
const fs = require("node:fs");
const path = require("node:path");
jestMock.mock("dockerode", () => jestMock.fn());
const Docker = require("dockerode");
const { Logger } = require("./logger");
const DockerAPIClient = require("./docker-api");

const certPath = path.resolve("synthetic-docker-certs");
const certificateNames = ["ca.pem", "cert.pem", "key.pem"];
const options = { dockerHost: "tcp://docker-test.invalid:2376", tlsVerify: true, certPath };

beforeEach(() => {
  Docker.mockClear();
  jestMock.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
});

afterEach(() => jestMock.restoreAllMocks());

describe("Docker TLS configuration", () => {
  test("rejects enabled TLS without a certificate directory", () => {
    expect(() => new DockerAPIClient({ ...options, certPath: "" }))
      .toThrow("DOCKER_CERT_PATH");
    expect(Docker).not.toHaveBeenCalled();
  });

  test.each(certificateNames)("rejects missing %s without creating an HTTP client", (missing) => {
    jestMock.spyOn(fs, "readFileSync").mockImplementation((filename) => {
      if (filename === path.join(certPath, missing)) throw new Error("ENOENT");
      return Buffer.from(path.basename(filename));
    });
    expect(() => new DockerAPIClient(options)).toThrow("Unable to load Docker TLS certificates");
    expect(Docker).not.toHaveBeenCalled();
  });

  test("rejects unreadable certificates without creating an HTTP client", () => {
    jestMock.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("EACCES"); });
    expect(() => new DockerAPIClient(options)).toThrow("Unable to load Docker TLS certificates");
    expect(Docker).not.toHaveBeenCalled();
  });

  test("loads the configured CA, certificate and key for HTTPS", () => {
    jestMock.spyOn(fs, "readFileSync").mockImplementation((filename) => Buffer.from(path.basename(filename)));
    new DockerAPIClient({ ...options, dockerHost: "tcp://docker-test.invalid:63377" });
    expect(Docker).toHaveBeenCalledWith({
      host: "docker-test.invalid", port: 63377, protocol: "https",
      ca: Buffer.from("ca.pem"), cert: Buffer.from("cert.pem"), key: Buffer.from("key.pem"),
    });
  });

  test("uses the TLS default port for a configured tcp endpoint", () => {
    jestMock.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("synthetic-certificate"));
    new DockerAPIClient({ ...options, dockerHost: "tcp://docker-test.invalid" });
    expect(Docker).toHaveBeenCalledWith(expect.objectContaining({ protocol: "https", port: 2376 }));
  });

  test("preserves deliberately configured plaintext TCP", () => {
    const read = jestMock.spyOn(fs, "readFileSync");
    new DockerAPIClient({ dockerHost: "tcp://docker-test.invalid", tlsVerify: false, certPath: "" });
    expect(Docker).toHaveBeenCalledWith({ host: "docker-test.invalid", port: 2375, protocol: "http" });
    expect(read).not.toHaveBeenCalled();
  });

  test("preserves local Unix sockets without network TLS files", () => {
    new DockerAPIClient({ ...options, dockerHost: "unix:///var/run/docker.sock", certPath: "" });
    expect(Docker).toHaveBeenCalledWith({ socketPath: "/var/run/docker.sock" });
  });
});
