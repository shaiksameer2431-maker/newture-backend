require('dotenv/config');
const keys = ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_SECURE','GMAIL_USER','GMAIL_APP_PASSWORD','EMAIL_FROM'];
keys.forEach(k => {
  const value = process.env[k];
  console.log(`${k}: ${value === undefined ? '<undefined>' : value ? '<set>' : '<empty>'}`);
});
console.log('cwd:', process.cwd());
