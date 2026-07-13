const path = require("path");

const root = path.join(process.env.HOME || "/home/sawaiz", "vaTeam-WebPage");

module.exports = {
  apps: [
    {
      name: "vateam-api",
      script: ".venv/bin/uvicorn",
      args: "main:app --host 127.0.0.1 --port 8006",
      cwd: path.join(root, "backend"),
      interpreter: "none",
      watch: false,
      max_memory_restart: "500M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: path.join(root, "logs/api-error.log"),
      out_file: path.join(root, "logs/api-out.log"),
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "vateam-web",
      script: "npm",
      args: "run start",
      cwd: path.join(root, "frontend"),
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PORT: "3011",
        NEXT_PUBLIC_API_URL: "",
      },
      watch: false,
      max_memory_restart: "700M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: path.join(root, "logs/web-error.log"),
      out_file: path.join(root, "logs/web-out.log"),
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
