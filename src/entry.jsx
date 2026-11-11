import { createRoot } from "react-dom/client";

const path = window.location.pathname;
const match = path.match(/^\/s(?:\/|)([1-9]\d*)\/?$/i);
const player = path.match(/^\/p\/([a-z][a-z0-9-]*)\/?$/i);
const user = path.match(/^\/u\/([a-z][a-z0-9]{3,31})\/?$/i);
if (match) {
  import("./archive/SeasonArchive.jsx").then(({ SeasonArchive }) => {
    createRoot(document.getElementById("root")).render(
      <SeasonArchive id={Number(match[1])} />,
    );
  });
} else if (
  /^\/(?:s|seasons)\/?$/i.test(path) ||
  /^\/s\/all\/?$/i.test(path) ||
  /^\/p\/?$/i.test(path) ||
  player ||
  user
) {
  import("./hub/Hub.jsx").then(
    ({ HubHome, HubSeasons, PlayersIndex, PlayerProfile, UserProfile }) => {
      const page = player ? (
        <PlayerProfile id={player[1]} />
      ) : user ? (
        <UserProfile id={user[1]} />
      ) : /^\/p\/?$/i.test(path) ? (
        <PlayersIndex />
      ) : /^\/s\/all\/?$/i.test(path) ? (
        <HubSeasons />
      ) : (
        <HubHome />
      );
      createRoot(document.getElementById("root")).render(page);
    },
  );
} else {
  import("./main.jsx");
}
