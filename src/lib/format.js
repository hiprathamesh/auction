export const money = (value) =>
  `₹${Number(value || 0)
    .toFixed(2)
    .replace(/\.00$/, "")} Cr`;
export const getTeam = (room, id) =>
  room?.users?.find((user) => user.id === id);
export const playerPath = (id) => "/p/" + encodeURIComponent(id);

export function playerStrengths(player) {
  const skills = player.skills;
  if (!skills) return [];
  const phase = {
    powerplay: "powerplay",
    middle: "middle overs",
    death: "death overs",
  };
  const strengths = [];
  if (skills.battingPhase)
    strengths.push(`Batting · ${phase[skills.battingPhase]}`);
  if (skills.bowlingPhase)
    strengths.push(`Bowling · ${phase[skills.bowlingPhase]}`);
  if (skills.hitting >= 90) strengths.push("Boundary hitter");
  else if (skills.rotation >= 90) strengths.push("Strike rotation");
  if (skills.prevention >= 93) strengths.push("Run prevention");
  else if (skills.wickets >= 90) strengths.push("Wicket threat");
  return strengths;
}
