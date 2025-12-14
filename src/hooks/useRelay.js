import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'http://localhost:5000';

export function useRelay(userId) {
  const [connected, setConnected] = useState(false);
  const [identified, setIdentified] = useState(false);
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    const socket = io(`${RELAY_URL}/relay`, {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Relay] Conectado:', socket.id);
      setConnected(true);
      
      if (userId) {
        socket.emit('identificar', userId, (ok) => {
          console.log('[Relay] Identificado:', userId);
          setIdentified(ok);
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[Relay] Desconectado:', reason);
      setConnected(false);
      setIdentified(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[Relay] Error:', error.message);
    });

    socket.on('relay', (data) => {
      listenersRef.current.forEach((callback) => callback(data));
    });

    socket.on('notificar', (data) => {
      listenersRef.current.forEach((callback, key) => {
        if (key.startsWith('notificar:')) callback(data);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [userId]);

  const enviar = useCallback((data, destino = 'nosotros') => {
    if (socketRef.current) {
      socketRef.current.emit('relay', { ...data, destino });
    }
  }, []);

  const enviarATodos = useCallback((data) => enviar(data, 'nosotros'), [enviar]);
  const enviarAOtros = useCallback((data) => enviar(data, 'ustedes'), [enviar]);
  const enviarAMi = useCallback((data) => enviar(data, 'yo'), [enviar]);

  const onMensaje = useCallback((callback) => {
    const key = `mensaje:${Date.now()}:${Math.random()}`;
    listenersRef.current.set(key, callback);
    return () => listenersRef.current.delete(key);
  }, []);

  return {
    connected,
    identified,
    enviar,
    enviarATodos,
    enviarAOtros,
    enviarAMi,
    onMensaje,
    socket: socketRef.current
  };
}

export default useRelay;



