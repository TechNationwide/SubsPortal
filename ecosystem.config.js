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
      // Cushion after PDF serialization; still restart before full host OOM.
      max_memory_restart: "1400M",
      env: {
        MALLOC_ARENA_MAX: "2",
        PDF_MAX_CONCURRENT: "1",
        PARTNER_MAX_CONCURRENT: "2",
        AQUAMARK_FLATTEN_MATRIX: "1.5",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: path.join(root, "logs/api-error.log"),
      out_file: path.join(root, "logs/api-out.log"),
      merge_logs: true,
      autorestart: true,
      max_restarts: 40,
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
