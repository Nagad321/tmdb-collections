const { addon } = require("./index.js");

const PORT = process.env.PORT || 5600;

// Avvia soltanto il server.
// Nessun precaricamento automatico dei cataloghi.
addon.listen(PORT, () => {
  console.log(`Addon active on port ${PORT}`);
  console.log("Automatic catalog buffering disabled");
});
