const webpush = require('web-push');
const fs = require('fs');

const vapidKeys = webpush.generateVAPIDKeys();

const config = {
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey
};

fs.writeFileSync('vapid.json', JSON.stringify(config, null, 2));
console.log('VAPID keys generated and saved to vapid.json');
console.log('Public Key:', vapidKeys.publicKey);
