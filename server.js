// express server
const express = require('express');
const app = express();
const http = require('http');

const port = Number(process.env.PORT) || 8080;

var io;

const maxUsers = process.env.MAX_USERS || 8;

const rooms = {
  users: 'users',
  control: 'control',
}

let userSlots = [];
let lastTriedSlotIndex = 0;

for (let i = 0; i < maxUsers; i++) {
  userSlots.push({
    slot_index: i + 1,
    client: {},
  });
}

async function main() {
  await setupHttpsServer();
  setupSocketServer();
}

main();

async function setupHttpsServer() {
  const serverHttps = http.createServer(app)
                          .listen(port, (e) => {
                            console.log('listening on ' + port);
                          });

  io = require('socket.io')({
    cors: true
  }).listen(serverHttps);
}

function random(mn, mx) {
  return Math.random() * (mx - mn) + mn;
}

const getRandomArrayElement = (arr) => {
  return arr[Math.floor(random(1, arr.length))-1];
}

const assignClientSlot = (roomState, newClient, requestedSlotIndex) => {
  // override requested slot and assign new client id to it
  if (requestedSlotIndex) {
    userSlots = userSlots.map(slot => {
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

  if (roomState.usedSlots + 1 > roomState.maxSlots) {
    console.log('no available slot for new client', newClient.id);
    return false;
  }

  // get free slots
  const freeSlots = userSlots.filter(slot => !slot.client.id);
  const freeSlotsExcludingLastTried = freeSlots.length > 1 ? freeSlots.filter(slot => slot.slot_index !== lastTriedSlotIndex) : freeSlots;

  // pick random free slot
  const nextFreeSlotIndex = getRandomArrayElement(freeSlotsExcludingLastTried).slot_index;

  // assign client id to it
  userSlots = userSlots.map(slot => {
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
  userSlots = userSlots.map(slot => {
    if (slot.client.id !== client.id) {
      return slot;
    }

    return {
      ...slot,
      client: {},
    }
  });
}

const createRoomState = (clientsInRoom) => {
  const numClients = clientsInRoom ? clientsInRoom.size : 0;

  return {
    usedSlots: numClients,
    maxSlots: maxUsers,
  };
}

function setupSocketServer() {
  console.log('setting up socket server');

  io.on('connection', (client) => {
    let assignedClientSlotIndex = false;

    // socket osc join request
    client.on('OSC_JOIN_REQUEST', (room) => {
      console.log(`OSC_JOIN_REQUEST`, client.id, room);
      client.join(rooms.control);

      io.sockets.to(client.id).emit('OSC_JOIN_ACCEPTED', {
        id: client.id,
      });

      const newRoomState = createRoomState(io.sockets.adapter.rooms.get(rooms.control));
      io.sockets.to(rooms.control).emit(
        'OSC_JOINED',
        newRoomState
      );
    });

    // user join request
    client.on('USER_JOIN_REQUEST', ({ room, wantsSlot }) => {
      console.log(`USER_JOIN_REQUEST`, client.id, room, wantsSlot);

      let requestedSlotIndex = false;
      if (wantsSlot && wantsSlot > 0 && wantsSlot <= maxUsers) {
        requestedSlotIndex = wantsSlot;
        console.log('=> requested slot, will overtake', requestedSlotIndex);
      }

      const roomState = createRoomState(io.sockets.adapter.rooms.get(rooms.users));
      assignedClientSlotIndex = assignClientSlot(roomState, client, requestedSlotIndex);
      lastTriedSlotIndex = assignedClientSlotIndex;

      if (assignedClientSlotIndex === false) {
        io.sockets.to(client.id).emit(
          'USER_JOIN_REJECTED',
          {
            reason: `Room is currently full ${roomState.usedSlots}/${roomState.maxSlots}`,
          }
        );

        return;
      }

      client.join(rooms.users);

      io.sockets.to(client.id).emit('USER_JOIN_ACCEPTED', {
        id: client.id,
        userSlot: assignedClientSlotIndex,
      });

      const newRoomState = createRoomState(io.sockets.adapter.rooms.get(rooms.users));
      console.log('OSC_CTRL_USER_JOINED', client.id);
      io.sockets.to(rooms.control).emit(
        'OSC_CTRL_USER_JOINED',
        {
          id: client.id,
          client_index: assignedClientSlotIndex,
          usedSlots: newRoomState.usedSlots,
          maxSlots: maxUsers,
        }
      );

      io.sockets.to(rooms.users).emit(
        'USER_JOINED',
        newRoomState
      );
    });

    client.on('disconnect', () => {
      const newRoomState = createRoomState(io.sockets.adapter.rooms.get(rooms.users));

      io.sockets.to(rooms.control).emit(
        'OSC_CTRL_USER_LEFT',
        {
          id: client.id,
          client_index: assignedClientSlotIndex,
          usedSlots: newRoomState.usedSlots,
          maxSlots: newRoomState.maxSlots,
        }
      );

      io.sockets.to(rooms.users).emit(
        'USER_LEFT',
        newRoomState,
      );

      resetClientSlot(client);
      console.log( 'User ' + client.id + '(' + assignedClientSlotIndex + ') disconnected');
    });

    client.on('OSC_CTRL_MESSAGE', (data) => {
      const processing_start = new Date().getTime();
      console.log('OSC_CTRL_MESSAGE', '| Slot:', assignedClientSlotIndex, '|', data)
      // @todo: make this dependant on current config
        // @todo: if we want to show users what others are doing in real time we'll need to broad cast to themn too
      io.sockets.to(rooms.control).emit(
        'OSC_CTRL_MESSAGE',
        {
          ...data,
          client_index: assignedClientSlotIndex,
          processed: new Date().getTime() - processing_start,
        }
      );
    });

    client.on('connect_failed', (err) => {
      console.log('connect failed!', err);
    });

    client.on('error', (err) => {
      console.log('there was an error on the connection!', err);
    });
  });
}