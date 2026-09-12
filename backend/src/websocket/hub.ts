import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import '@fastify/websocket';
import { WebSocket } from 'ws';
import { logger } from '../utils/logger.js';

export interface WarRoomMessage {
  type: 'INCIDENT_STATUS_CHANGED' | 'TIMELINE_EVENT_ADDED' | 'ALERT_LINKED' | 'RUNBOOK_LOG_CHUNK' | 'PRESENCE_UPDATE';
  incidentId: string;
  payload: unknown;
  timestamp: string;
}

// In-memory room manager: incidentId -> Set of active WebSockets
const warRooms = new Map<string, Set<WebSocket>>();

export function broadcastToWarRoom(incidentId: string, message: WarRoomMessage): void {
  const clients = warRooms.get(incidentId);
  if (!clients || clients.size === 0) {
    return;
  }

  const serialized = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }

  logger.debug({ incidentId, clientCount: clients.size, messageType: message.type }, 'Broadcasted war room message');
}

export const webSocketRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    '/ws/war-room/:incidentId',
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest<{ Params: { incidentId: string } }>) => {
      const { incidentId } = req.params;

      if (!warRooms.has(incidentId)) {
        warRooms.set(incidentId, new Set());
      }
      const room = warRooms.get(incidentId)!;
      room.add(socket);

      logger.info({ incidentId, activeClients: room.size, ip: req.ip }, 'Client connected to Incident War Room');

      // Notify room of presence update
      broadcastToWarRoom(incidentId, {
        type: 'PRESENCE_UPDATE',
        incidentId,
        payload: { activeUsers: room.size, event: 'JOINED' },
        timestamp: new Date().toISOString(),
      });

      // Handle incoming client messages (e.g. heartbeat ping)
      socket.on('message', (rawMessage: string | Buffer) => {
        try {
          const data = JSON.parse(rawMessage.toString());
          if (data.type === 'PING') {
            socket.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
          }
        } catch {
          // Ignore unparseable client messages
        }
      });

      // Handle client disconnect
      socket.on('close', () => {
        room.delete(socket);
        if (room.size === 0) {
          warRooms.delete(incidentId);
        } else {
          broadcastToWarRoom(incidentId, {
            type: 'PRESENCE_UPDATE',
            incidentId,
            payload: { activeUsers: room.size, event: 'LEFT' },
            timestamp: new Date().toISOString(),
          });
        }
        logger.info({ incidentId, remainingClients: room.size }, 'Client disconnected from Incident War Room');
      });

      socket.on('error', (err: Error) => {
        logger.error({ err, incidentId }, 'War room WebSocket error');
      });
    }
  );
};
