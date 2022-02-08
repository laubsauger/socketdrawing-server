// express server
const fs = require('fs');
const express = require('express');
const app = express();
// const https = require('https');
const https = require('http');
const io = require('socket.io');

app.use(express.static('public'));

options = {
  // key: fs.readFileSync('certs/server.key'),
  // cert: fs.readFileSync('certs/server.crt')
};

const port = Number(process.env.PORT) || 80;

const maxActiveClients = process.env.MAX_USERS || 4;

let clientSlots = [];
let lastTriedSlotIndex = 0;

for (let i=0; i<maxActiveClients; i++) {
  clientSlots.push({
    slot_index: i+1,
    client: {},
  });
}

async function main() {
  await setupHttpsServer();
  setupSocketServer();
}

main();

async function setupHttpsServer() {
  const serverHttps = https.createServer(options, app).listen(port, (e) => {
    console.log('listening on ' + port);
  });

  io({
    cors: true
  }).listen(serverHttps);
}

function random(mn, mx) {
  return Math.random() * (mx - mn) + mn;
}

const getRandomArrayElement = (arr) => {
  return arr[Math.floor(random(1, arr.length))-1];
}

const assignClientSlot = (newClient, requestedSlotIndex) => {
  if (requestedSlotIndex) {
    // assign client id to it
    clientSlots = clientSlots.map(slot => {
      if (slot.slot_index !== requestedSlotIndex) {
        return slot;
      }

      if (slot.client.id) {
        console.log('slot is occupied, disconnecting current tenant', slot.client.id);
        slot.client.disconnect();
      }

      return {
        ...slot,
        client: newClient,
      }
    });

    return requestedSlotIndex;
  }

  const usedSlots = getUsedClientSlots();

  if (usedSlots.length + 1 > maxActiveClients) {
    console.log('no available slot for new client', newClient.id);
    return false;
  }

  const freeSlots = clientSlots.filter(slot => !slot.client.id);
  const freeSlotsExcludingLastTried = freeSlots.length > 1 ? freeSlots.filter(slot => slot.slot_index !== lastTriedSlotIndex) : freeSlots;
  // get random free slot
  const nextFreeSlotIndex = getRandomArrayElement(freeSlotsExcludingLastTried).slot_index;

  // assign client id to it
  clientSlots = clientSlots.map(slot => {
    if (slot.slot_index !== nextFreeSlotIndex) {
      return slot;
    }

    return {
      ...slot,
      client: newClient,
    }
  });

  return nextFreeSlotIndex;
}

const resetClientSlot = (client) => {
  clientSlots = clientSlots.map(slot => {
    if (slot.client.id !== client.id) {
      return slot;
    }

    return {
      ...slot,
      client: {},
    }
  });
}

const getUsedClientSlots = () => {
  return clientSlots.filter(slot => !!slot.client.id);
}

function setupSocketServer() {
  console.log('setting up socket server');
  io.on('connection', (client) => {
    let requestedSlotIndex = false;
    if (client.handshake.query && client.handshake.query['wantsSlot']) {
      requestedSlotIndex = Number(client.handshake.query['wantsSlot']);
      console.log('requested slot, will overtake', requestedSlotIndex);
    }

    const assignedClientSlotIndex = assignClientSlot(client, requestedSlotIndex);
    lastTriedSlotIndex = assignedClientSlotIndex;

    if (assignedClientSlotIndex === false) {
      console.log('no slot assigned, ejecting');
      client.disconnect();
      return;
    }

    const usedClientSlots = getUsedClientSlots();
    console.log(`User ${usedClientSlots.length}/${maxActiveClients} ` + client.id + ' connected. Assigning index: ' + assignedClientSlotIndex);
    console.log('  ');

    client.emit(
      'introduction',
      {
        id: client.id,
        client_index: assignedClientSlotIndex,
        clients: Object.keys(clientSlots),
        usedSlots: getUsedClientSlots().length,
        maxClients: maxActiveClients,
      }
    );

    io.sockets.emit(
      'newUserConnected',
      {
        id: client.id,
        client_index: assignedClientSlotIndex,
        clients: Object.keys(clientSlots),
        usedSlots: getUsedClientSlots().length,
        maxClients: maxActiveClients,
      }
    );

    client.on('disconnect', () => {
      resetClientSlot(client);

      io.sockets.emit(
        'userDisconnected',
        {
          id: client.id,
          client_index: assignedClientSlotIndex,
          clients: Object.keys(clientSlots),
          usedSlots: getUsedClientSlots().length,
          maxClients: maxActiveClients,
        }
      );

      console.log( 'User ' + client.id + '(' + assignedClientSlotIndex + ') disconnected');
    });

    client.on('connect_failed', (err) => {
      console.log('connect failed!', err);
    });

    client.on('error', (err) => {
      console.log('there was an error on the connection!', err);
    });

    client.on('message', (data) => {
      console.log(assignedClientSlotIndex + ':' + data.message, data);
      io.sockets.emit(
        'onMessage',
        {
          client_index: assignedClientSlotIndex,
          ...data
        }
      );
    });
  });
}