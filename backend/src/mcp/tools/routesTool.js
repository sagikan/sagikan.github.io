const fs = require("fs");
const path = require("path");
const { splitTopLevel } = require("./splitTopLevel");

const ROUTE_PATTERN = /router\.(get|post|put|patch|delete)\(\s*"([^"]*)"\s*,([^\n]*?)(?:async\s*)?\(req,\s*res(?:,\s*next)?\)\s*=>/g;
const SHARED_PATTERN = /^router\.use\((.*)\);$/gm;
const REQUIRE_PATTERN = /const (\w+) = require\("\.\/routes\/(\w+)"\)/g;
const MOUNT_PATTERN = /app\.use\(\s*"([^"]+)"[^;]*?(\w+)\s*\);/g;

// Reads the routes and the middleware shared by a whole router from a route file
function parseRoutes(source) {
  const routes = [];
  const shared = [];

  for (const [, method, routePath, middleware] of source.matchAll(ROUTE_PATTERN)) {
    routes.push({ method: method.toUpperCase(), path: routePath, middleware: splitTopLevel(middleware) });
  }

  for (const [, args] of source.matchAll(SHARED_PATTERN)) {
    if (!args.includes("=>")) {
      shared.push(...splitTopLevel(args));
    }
  }

  return { routes, shared };
}

// Maps each route file name to the path prefix it is mounted on in app.js
function parseMounts(source) {
  const files = {};
  const mounts = {};

  for (const [, name, file] of source.matchAll(REQUIRE_PATTERN)) {
    files[name] = file;
  }

  for (const [, prefix, name] of source.matchAll(MOUNT_PATTERN)) {
    if (files[name]) {
      mounts[files[name]] = prefix;
    }
  }

  return mounts;
}

// Reads every route file with its mount prefix, shared middleware and routes (each with its full path)
function collectRoutes(srcDir) {
  const mounts = parseMounts(fs.readFileSync(path.join(srcDir, "app.js"), "utf8"));

  return Object.entries(mounts).map(([file, prefix]) => {
    const { routes, shared } = parseRoutes(fs.readFileSync(path.join(srcDir, "routes", `${file}.js`), "utf8"));

    return {
      file,
      prefix,
      shared,
      routes: routes.map((route) => ({ ...route, fullPath: route.path === "/" ? prefix : `${prefix}${route.path}` }))
    };
  });
}

// Lists every API route with its middleware, optionally only those whose path contains the filter
function listRoutes(srcDir, filter = "") {
  const needle = filter.toLowerCase();
  const lines = [];

  for (const { file, prefix, shared, routes } of collectRoutes(srcDir)) {
    const matching = routes.filter((route) => route.fullPath.toLowerCase().includes(needle));

    if (matching.length === 0) {
      continue;
    }

    lines.push(`# ${file} (${prefix})${shared.length ? ` all routes: ${shared.join(", ")}` : ""}`);

    for (const route of matching) {
      const extra = route.middleware.length ? `  + ${route.middleware.join(", ")}` : "";

      lines.push(`${route.method.padEnd(6)} ${route.fullPath}${extra}`);
    }
  }

  return lines.length ? lines.join("\n") : "No routes found.";
}

module.exports = { parseRoutes, parseMounts, collectRoutes, listRoutes };
