// express server
const fs = require('fs');
const express = require('express');
const {request} = require("express");
const app = express();
app.use(express.static('public'));

options = {
  // key: fs.readFileSync('certs/server.key'),
  // cert: fs.readFileSync('certs/server.crt')
};

var port;
var io;

const maxActiveClients = process.env.MAX_USERS || 4;

let clientSlots = [];

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
  const https = require('http');
  port = process.env.PORT || 8080;

  var serverHttps = https.createServer(options, app).listen(port, (e) => {
    console.log('listening on ' + port);
  });

  io = require('socket.io')({
    cors: true
  }).listen(serverHttps);
}

const assignClientSlot = (newClient, requestedSlot) => {
  if (requestedSlot) {
    // assign client id to it
    clientSlots = clientSlots.map(slot => {
      if (slot.slot_index !== requestedSlot) {
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

    return requestedSlot;
  }

  const usedSlots = getUsedClientSlots();

  if (usedSlots.length + 1 > maxActiveClients) {
    console.log('no available slot for new client', newClient.id);
    return false;
  }

  // get first free slot
  const nextFreeSlotIndex = clientSlots.filter(slot => !slot.client.id)[0].slot_index;

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
    let requestedSlot = false;
    if (client.handshake.query && client.handshake.query['wantsSlot']) {
      requestedSlot = Number(client.handshake.query['wantsSlot']);
      console.log('requested slot, will overtake', requestedSlot);
    }

    const assignedClientSlotIndex = assignClientSlot(client, requestedSlot);

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
      resetClientSlot(client.id);

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