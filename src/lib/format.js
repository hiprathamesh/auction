export const money = (value) =>
  `₹${Number(value || 0)
    .toFixed(2)
    .replace(/\.00$/, "")} Cr`;
export const getTeam = (room, id) =>
  room?.users?.find((user) => user.id === id);
export const playerPath = (id) => "/p/" + encodeURIComponent(id);
