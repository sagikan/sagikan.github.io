import { useEffect, useState } from "react";
import { apiLogo } from "../lib/api";

const logos = new Map();

// Loads a company's logo once per session and returns it as an object URL, or null
function loadLogo(company) {
  const key = company.trim().toLowerCase();

  if (!logos.has(key)) {
    logos.set(key, apiLogo(company).then((blob) => (blob ? URL.createObjectURL(blob) : null)).catch(() => {
      logos.delete(key);

      return null;
    }));
  }

  return logos.get(key);
}

// Returns the URL of a company's logo once it has loaded, or null while loading or when there is none
export function useCompanyLogo(company) {
  const [logo, setLogo] = useState({ company: "", url: null });

  useEffect(() => {
    if (!company?.trim()) {
      return undefined;
    }

    let current = true;

    loadLogo(company).then((url) => current && setLogo({ company, url }));

    return () => {
      current = false;
    };
  }, [company]);

  return logo.company === company ? logo.url : null;
}
