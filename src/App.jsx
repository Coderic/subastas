import { useState, useEffect, useMemo, useRef } from 'react';
import { useRelay } from './hooks/usePasarela';
import './App.css';

const SESSION_ID = localStorage.getItem('subastaSession') || (() => {
  const id = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('subastaSession', id);
  return id;
})();

const ESTADOS_SUBASTA = {
  ACTIVA: 'activa',
  FINALIZADA: 'finalizada',
  CANCELADA: 'cancelada'
};

function App() {
  const { connected, enviarATodos, onMensaje } = useRelay(SESSION_ID);
  
  const [vista, setVista] = useState('lista'); // lista, subasta, admin
  const [subastas, setSubastas] = useState([]);
  const [subastaActual, setSubastaActual] = useState(null);
  const [miNombre, setMiNombre] = useState(localStorage.getItem('miNombre') || '');
  const [notificacion, setNotificacion] = useState(null);
  const [nuevaSubasta, setNuevaSubasta] = useState({
    titulo: '',
    descripcion: '',
    precioInicial: '',
    incrementoMinimo: '',
    duracionMinutos: ''
  });

  // Escuchar mensajes
  useEffect(() => {
    const unsubscribe = onMensaje((data) => {
      switch (data.tipo) {
        case 'nueva_subasta':
          setSubastas(prev => [...prev, data.subasta]);
          break;

        case 'subasta_actualizada':
          setSubastas(prev => prev.map(s => 
            s.id === data.subasta.id ? { ...s, ...data.subasta } : s
          ));
          if (subastaActual?.id === data.subasta.id) {
            setSubastaActual(data.subasta);
          }
          break;

        case 'nueva_puja':
          const subasta = subastas.find(s => s.id === data.subastaId);
          if (subasta) {
            const subastaActualizada = {
              ...subasta,
              precioActual: data.precio,
              ultimaPuja: {
                usuario: data.usuario,
                precio: data.precio,
                timestamp: Date.now()
              },
              pujas: [...(subasta.pujas || []), {
                usuario: data.usuario,
                precio: data.precio,
                timestamp: Date.now()
              }]
            };
            setSubastas(prev => prev.map(s => 
              s.id === data.subastaId ? subastaActualizada : s
            ));
            
            if (subastaActual?.id === data.subastaId) {
              setSubastaActual(subastaActualizada);
            }
            
            // Notificación si no es mi puja
            if (data.usuario !== miNombre) {
              setNotificacion({
                tipo: 'puja',
                mensaje: `¡${data.usuario} pujó $${data.precio.toFixed(2)}!`,
                subastaId: data.subastaId
              });
            }
          }
          break;

        case 'subasta_finalizada':
          setSubastas(prev => prev.map(s => 
            s.id === data.subastaId 
              ? { ...s, estado: ESTADOS_SUBASTA.FINALIZADA, ganador: data.ganador }
              : s
          ));
          if (subastaActual?.id === data.subastaId) {
            setSubastaActual(prev => ({ 
              ...prev, 
              estado: ESTADOS_SUBASTA.FINALIZADA, 
              ganador: data.ganador 
            }));
          }
          break;

        case 'sync_subastas':
          if (data.subastas) {
            setSubastas(data.subastas);
          }
          break;
      }
    });

    return unsubscribe;
  }, [onMensaje, subastas, subastaActual, miNombre]);

  // Solicitar sincronización al conectar
  useEffect(() => {
    if (connected) {
      enviarATodos({ tipo: 'sync_request', sessionId: SESSION_ID });
    }
  }, [connected, enviarATodos]);

  // Actualizar timers de subastas
  useEffect(() => {
    const interval = setInterval(() => {
      setSubastas(prev => prev.map(subasta => {
        if (subasta.estado !== ESTADOS_SUBASTA.ACTIVA) return subasta;
        
        const tiempoRestante = subasta.finTimestamp - Date.now();
        if (tiempoRestante <= 0) {
          // Finalizar subasta
          enviarATodos({
            tipo: 'subasta_finalizada',
            subastaId: subasta.id,
            ganador: subasta.ultimaPuja?.usuario || null
          });
          return { ...subasta, estado: ESTADOS_SUBASTA.FINALIZADA };
        }
        return { ...subasta, tiempoRestante };
      }));
      
      if (subastaActual && subastaActual.estado === ESTADOS_SUBASTA.ACTIVA) {
        const tiempoRestante = subastaActual.finTimestamp - Date.now();
        if (tiempoRestante <= 0) {
          setSubastaActual(prev => ({ ...prev, estado: ESTADOS_SUBASTA.FINALIZADA }));
        } else {
          setSubastaActual(prev => ({ ...prev, tiempoRestante }));
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [subastaActual, enviarATodos]);

  // Cerrar notificación
  useEffect(() => {
    if (notificacion) {
      const timer = setTimeout(() => setNotificacion(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notificacion]);

  const guardarNombre = () => {
    if (miNombre.trim()) {
      localStorage.setItem('miNombre', miNombre);
      setNotificacion({ tipo: 'success', mensaje: 'Nombre guardado' });
    }
  };

  const crearSubasta = () => {
    if (!nuevaSubasta.titulo || !nuevaSubasta.precioInicial) {
      setNotificacion({ tipo: 'error', mensaje: 'Completa todos los campos requeridos' });
      return;
    }

    const subasta = {
      id: 'subasta_' + Date.now(),
      titulo: nuevaSubasta.titulo,
      descripcion: nuevaSubasta.descripcion,
      precioInicial: parseFloat(nuevaSubasta.precioInicial),
      precioActual: parseFloat(nuevaSubasta.precioInicial),
      incrementoMinimo: parseFloat(nuevaSubasta.incrementoMinimo) || 1,
      duracionMinutos: parseInt(nuevaSubasta.duracionMinutos) || 5,
      inicioTimestamp: Date.now(),
      finTimestamp: Date.now() + (parseInt(nuevaSubasta.duracionMinutos) || 5) * 60 * 1000,
      tiempoRestante: (parseInt(nuevaSubasta.duracionMinutos) || 5) * 60 * 1000,
      estado: ESTADOS_SUBASTA.ACTIVA,
      creador: miNombre || SESSION_ID,
      pujas: [],
      ultimaPuja: null
    };

    setSubastas(prev => [...prev, subasta]);
    enviarATodos({ tipo: 'nueva_subasta', subasta });
    
    setNuevaSubasta({
      titulo: '',
      descripcion: '',
      precioInicial: '',
      incrementoMinimo: '',
      duracionMinutos: ''
    });
    
    setNotificacion({ tipo: 'success', mensaje: 'Subasta creada' });
  };

  const pujar = (subastaId, precio) => {
    const subasta = subastas.find(s => s.id === subastaId);
    if (!subasta || subasta.estado !== ESTADOS_SUBASTA.ACTIVA) return;
    
    if (precio <= subasta.precioActual) {
      setNotificacion({ tipo: 'error', mensaje: 'La puja debe ser mayor al precio actual' });
      return;
    }

    const usuario = miNombre || SESSION_ID;
    enviarATodos({
      tipo: 'nueva_puja',
      subastaId,
      usuario,
      precio
    });
  };

  const pujarIncremento = (subastaId) => {
    const subasta = subastas.find(s => s.id === subastaId);
    if (!subasta) return;
    
    const nuevoPrecio = subasta.precioActual + subasta.incrementoMinimo;
    pujar(subastaId, nuevoPrecio);
  };

  const abrirSubasta = (subasta) => {
    setSubastaActual(subasta);
    setVista('subasta');
  };

  const formatearTiempo = (ms) => {
    if (ms <= 0) return 'Finalizada';
    const segundos = Math.floor(ms / 1000);
    const minutos = Math.floor(segundos / 60);
    const horas = Math.floor(minutos / 60);
    const dias = Math.floor(horas / 24);
    
    if (dias > 0) return `${dias}d ${horas % 24}h`;
    if (horas > 0) return `${horas}h ${minutos % 60}m`;
    if (minutos > 0) return `${minutos}m ${segundos % 60}s`;
    return `${segundos}s`;
  };

  const subastasActivas = useMemo(() => 
    subastas.filter(s => s.estado === ESTADOS_SUBASTA.ACTIVA),
    [subastas]
  );

  const subastasFinalizadas = useMemo(() => 
    subastas.filter(s => s.estado === ESTADOS_SUBASTA.FINALIZADA),
    [subastas]
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>🔨 Subastas en Tiempo Real</h1>
        <div className="header-controls">
          <div className="nombre-input">
            <input
              type="text"
              placeholder="Tu nombre"
              value={miNombre}
              onChange={(e) => setMiNombre(e.target.value)}
              onBlur={guardarNombre}
              maxLength={20}
            />
          </div>
          <div className={`status ${connected ? 'online' : ''}`}>
            <span className="dot"></span>
            {connected ? 'Conectado' : 'Desconectado'}
          </div>
        </div>
      </header>

      <div className="tabs">
        <button 
          className={`tab ${vista === 'lista' ? 'active' : ''}`}
          onClick={() => setVista('lista')}
        >
          📋 Subastas
        </button>
        <button 
          className={`tab ${vista === 'admin' ? 'active' : ''}`}
          onClick={() => setVista('admin')}
        >
          ➕ Crear Subasta
        </button>
        {subastaActual && (
          <button 
            className={`tab ${vista === 'subasta' ? 'active' : ''}`}
            onClick={() => setVista('subasta')}
          >
            🎯 {subastaActual.titulo.substring(0, 20)}...
          </button>
        )}
      </div>

      {/* Notificación */}
      {notificacion && (
        <div className={`notificacion ${notificacion.tipo}`}>
          <span>{notificacion.mensaje}</span>
          <button onClick={() => setNotificacion(null)}>✕</button>
        </div>
      )}

      {/* Vista Lista */}
      {vista === 'lista' && (
        <div className="vista-lista">
          <div className="subastas-activas">
            <h2>🔥 Subastas Activas ({subastasActivas.length})</h2>
            <div className="subastas-grid">
              {subastasActivas.map(subasta => (
                <div key={subasta.id} className="subasta-card" onClick={() => abrirSubasta(subasta)}>
                  <div className="subasta-header">
                    <h3>{subasta.titulo}</h3>
                    <div className="subasta-timer urgent">
                      ⏱️ {formatearTiempo(subasta.tiempoRestante)}
                    </div>
                  </div>
                  <p className="subasta-descripcion">{subasta.descripcion || 'Sin descripción'}</p>
                  <div className="subasta-precio">
                    <div className="precio-actual">${subasta.precioActual.toFixed(2)}</div>
                    <div className="precio-info">
                      Inicio: ${subasta.precioInicial.toFixed(2)} • Incremento: ${subasta.incrementoMinimo.toFixed(2)}
                    </div>
                  </div>
                  {subasta.ultimaPuja && (
                    <div className="ultima-puja">
                      Última puja: <strong>{subasta.ultimaPuja.usuario}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="subastas-finalizadas">
            <h2>✅ Subastas Finalizadas ({subastasFinalizadas.length})</h2>
            <div className="subastas-grid">
              {subastasFinalizadas.map(subasta => (
                <div key={subasta.id} className="subasta-card finalizada" onClick={() => abrirSubasta(subasta)}>
                  <div className="subasta-header">
                    <h3>{subasta.titulo}</h3>
                    <div className="subasta-badge">Finalizada</div>
                  </div>
                  <div className="subasta-precio">
                    <div className="precio-actual">${subasta.precioActual.toFixed(2)}</div>
                    {subasta.ganador && (
                      <div className="ganador">
                        🏆 Ganador: <strong>{subasta.ganador}</strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Vista Admin */}
      {vista === 'admin' && (
        <div className="vista-admin">
          <div className="admin-panel">
            <h2>➕ Crear Nueva Subasta</h2>
            <div className="form-group">
              <label>Título *</label>
              <input
                type="text"
                value={nuevaSubasta.titulo}
                onChange={(e) => setNuevaSubasta({ ...nuevaSubasta, titulo: e.target.value })}
                placeholder="Ej: iPhone 15 Pro Max"
              />
            </div>
            <div className="form-group">
              <label>Descripción</label>
              <textarea
                value={nuevaSubasta.descripcion}
                onChange={(e) => setNuevaSubasta({ ...nuevaSubasta, descripcion: e.target.value })}
                placeholder="Describe el artículo..."
                rows={4}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Precio Inicial ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={nuevaSubasta.precioInicial}
                  onChange={(e) => setNuevaSubasta({ ...nuevaSubasta, precioInicial: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Incremento Mínimo ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={nuevaSubasta.incrementoMinimo}
                  onChange={(e) => setNuevaSubasta({ ...nuevaSubasta, incrementoMinimo: e.target.value })}
                  placeholder="1.00"
                />
              </div>
              <div className="form-group">
                <label>Duración (minutos)</label>
                <input
                  type="number"
                  min="1"
                  value={nuevaSubasta.duracionMinutos}
                  onChange={(e) => setNuevaSubasta({ ...nuevaSubasta, duracionMinutos: e.target.value })}
                  placeholder="5"
                />
              </div>
            </div>
            <button className="btn-crear" onClick={crearSubasta}>
              🚀 Crear Subasta
            </button>
          </div>
        </div>
      )}

      {/* Vista Subasta */}
      {vista === 'subasta' && subastaActual && (
        <div className="vista-subasta">
          <div className="subasta-detalle">
            <div className="subasta-info">
              <h2>{subastaActual.titulo}</h2>
              <p className="subasta-descripcion-detalle">{subastaActual.descripcion || 'Sin descripción'}</p>
              
              <div className="subasta-timer-grande">
                {subastaActual.estado === ESTADOS_SUBASTA.ACTIVA ? (
                  <>
                    <div className="timer-label">Tiempo Restante</div>
                    <div className="timer-value">{formatearTiempo(subastaActual.tiempoRestante)}</div>
                  </>
                ) : (
                  <div className="timer-value finalizada">Finalizada</div>
                )}
              </div>

              <div className="precio-grande">
                <div className="precio-label">Precio Actual</div>
                <div className="precio-valor">${subastaActual.precioActual.toFixed(2)}</div>
                <div className="precio-info-detalle">
                  Precio inicial: ${subastaActual.precioInicial.toFixed(2)} • Incremento mínimo: ${subastaActual.incrementoMinimo.toFixed(2)}
                </div>
              </div>

              {subastaActual.estado === ESTADOS_SUBASTA.ACTIVA && (
                <div className="acciones-puja">
                  <button 
                    className="btn-puja-incremento"
                    onClick={() => pujarIncremento(subastaActual.id)}
                  >
                    Pujar +${subastaActual.incrementoMinimo.toFixed(2)}
                  </button>
                  <div className="puja-personalizada">
                    <input
                      type="number"
                      step="0.01"
                      min={subastaActual.precioActual + subastaActual.incrementoMinimo}
                      placeholder={`Mín: $${(subastaActual.precioActual + subastaActual.incrementoMinimo).toFixed(2)}`}
                      id="puja-custom"
                    />
                    <button 
                      className="btn-puja-custom"
                      onClick={() => {
                        const input = document.getElementById('puja-custom');
                        const precio = parseFloat(input.value);
                        if (precio) {
                          pujar(subastaActual.id, precio);
                          input.value = '';
                        }
                      }}
                    >
                      Pujar
                    </button>
                  </div>
                </div>
              )}

              {subastaActual.ganador && (
                <div className="ganador-grande">
                  🏆 Ganador: <strong>{subastaActual.ganador}</strong>
                </div>
              )}
            </div>

            <div className="historial-pujas">
              <h3>📜 Historial de Pujas ({subastaActual.pujas?.length || 0})</h3>
              <div className="pujas-lista">
                {subastaActual.pujas && subastaActual.pujas.length > 0 ? (
                  [...subastaActual.pujas].reverse().map((puja, index) => (
                    <div key={index} className="puja-item">
                      <div className="puja-usuario">{puja.usuario}</div>
                      <div className="puja-precio">${puja.precio.toFixed(2)}</div>
                      <div className="puja-tiempo">
                        {new Date(puja.timestamp).toLocaleTimeString('es')}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sin-pujas">Aún no hay pujas</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
