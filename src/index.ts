import http from "http";
import { app } from "./app";
import { env } from "./config/env";

const server = http.createServer(app);

const startServer = () => {
  server.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });
};

startServer();
