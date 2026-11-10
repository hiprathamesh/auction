import { createRoot } from "react-dom/client";

const match = window.location.pathname.match(/^\/s([1-9]\d*)\/?$/i);
if (match || /^\/seasons\/?$/i.test(window.location.pathname)) {
  import("./archive/SeasonArchive.jsx").then(({ SeasonArchive }) => {
    createRoot(document.getElementById("root")).render(
      <SeasonArchive id={match ? Number(match[1]) : null} />,
    );
  });
} else {
  import("./main.jsx");
}
