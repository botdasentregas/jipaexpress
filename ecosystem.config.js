module.exports = {
    apps: [
      {
        name: "bot-jipaexpress",
        script: "./index.js", // ou ./bot.js dependendo do nome do seu arquivo
        autorestart: true,
        restart_delay: 5000,
        max_memory_restart: "300M",
        cron_restart: "0 */1 * * *", // reinício a cada 1h
      },
    ],
  };
  