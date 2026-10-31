import { useState } from "react";
import { useCompanyLogo } from "../../hooks/useCompanyLogo";

// Picks a stable hue for a letter
function hueOf(letter) {
  return Math.round(letter.codePointAt(0) * 137.508) % 360;
}

// Shows a company's logo when it has one (unless logo is false), or its first letter in a colored circle
function CompanyAvatar({ company, logo = true }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const url = useCompanyLogo(logo ? company : "");
  const letter = company.trim()[0]?.toUpperCase() || "?";

  if (url && url !== failedUrl) {
    return (
      <span className="avatar avatar-logo">
        <img src={url} alt="" onError={() => setFailedUrl(url)} />
      </span>
    );
  }

  return (
    <span className="avatar avatar-initial" style={{ "--hue": hueOf(letter) }}>
      {letter}
    </span>
  );
}

export default CompanyAvatar;
