// Otimização de rota via OSRM (servidor demo público, gratuito, uso pessoal/baixo volume).
// stops: [{lat, lng, ...}]  origin (opcional): {lat, lng}
// Retorna { order: [indices na ordem otimizada], distanceKm, durationMin, geometry }
export async function optimizeTrip(stops, origin) {
  const points = origin ? [origin, ...stops] : stops;
  const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
  // Com ponto de partida fixo: sai do início, termina onde for melhor (sem voltar).
  // Sem ponto de partida: o OSRM só aceita início/fim livres fazendo um circuito (roundtrip);
  // usamos a ordem calculada e ignoramos a perna de volta ao início.
  const params = origin
    ? "source=first&destination=any&roundtrip=false"
    : "roundtrip=true";
  const url = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?${params}&overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok") throw new Error("Não foi possível otimizar a rota (" + data.code + ")");

  const trip = data.trips[0];
  // waypoints[i].waypoint_index = posição na ordem otimizada; trip_index é sempre 0 aqui
  const waypoints = data.waypoints;
  const offset = origin ? 1 : 0;

  const ordered = waypoints
    .map((wp, originalIndex) => ({ originalIndex, order: wp.waypoint_index }))
    .filter((w) => w.originalIndex >= offset)
    .sort((a, b) => a.order - b.order)
    .map((w) => w.originalIndex - offset);

  if (origin) {
    return {
      order: ordered,
      distanceKm: trip.distance / 1000,
      durationMin: trip.duration / 60,
      geometry: trip.geometry,
    };
  }

  // Sem ponto de partida fixo o OSRM só calcula em modo circuito (roundtrip),
  // então descontamos a última perna (volta ao ponto inicial) da distância/duração
  // e não desenhamos a linha da rota (a geometria completa incluiria a volta).
  const legs = trip.legs || [];
  const oneWayLegs = legs.slice(0, -1);
  const distance = oneWayLegs.reduce((sum, l) => sum + l.distance, 0);
  const duration = oneWayLegs.reduce((sum, l) => sum + l.duration, 0);

  return {
    order: ordered,
    distanceKm: distance / 1000,
    durationMin: duration / 60,
    geometry: null,
  };
}

// Calcula distância/duração/geometria pra uma ordem de paradas JÁ DECIDIDA (usa o serviço /route
// do OSRM, que — ao contrário do /trip usado em optimizeTrip — nunca reordena os pontos). Usado
// quando a ordem já foi definida na mão (ex: prioridade por horário limite) e só precisamos saber
// o "custo" real (km/min/traçado) de percorrer essa sequência específica.
export async function routeInOrder(stops, origin) {
  const points = origin ? [origin, ...stops] : stops;
  if (points.length < 2) return { distanceKm: 0, durationMin: 0, geometry: null };
  const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok") throw new Error("Não foi possível calcular a rota (" + data.code + ")");

  const route = data.routes[0];
  return { distanceKm: route.distance / 1000, durationMin: route.duration / 60, geometry: route.geometry };
}
