module.exports = {
  apps: [
    {
      name: 'gpt-codex',
      script: './server/index.js',
      cwd: '/root/codex/webauthn-yubikey-demo',
      env: {
        PORT: 4000,
        RP_ID: 'gpt-codex.b244.ru',
        ORIGIN: 'https://gpt-codex.b244.ru',
        RP_NAME: 'YubiKey Auth Demo',
        ATTESTATION: 'none',
      },
    },
  ],
};
