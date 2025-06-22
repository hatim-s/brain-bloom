"use server";

import { AIMindmap } from "@/types/AI";

const SAMPLE_DATA = [
  {
    nodeId: "root",
    title: "Renewable Energy",
    description:
      "Energy from naturally replenished sources with low carbon footprint",
    link: "https://en.wikipedia.org/wiki/Renewable_energy",
    childrenNodes: ["coreTypes", "emergingTech", "benefits", "challenges"],
  },
  {
    nodeId: "coreTypes",
    title: "Core Types",
    description: "Widely used renewable sources",
    link: null,
    childrenNodes: ["solar", "wind", "hydro", "bio"],
  },
  {
    nodeId: "solar",
    title: "Solar Power",
    description: "Energy from sunlight via PV or thermal",
    link: "https://en.wikipedia.org/wiki/Solar_energy",
    childrenNodes: ["pv", "csp"],
  },
  {
    nodeId: "pv",
    title: "Photovoltaic (PV)",
    description: "Converts sunlight directly to electricity",
    link: "https://en.wikipedia.org/wiki/Photovoltaic_power_station",
  },
  {
    nodeId: "csp",
    title: "Concentrated Solar Power (CSP)",
    description: "Uses mirrors to concentrate solar heat for power",
    link: "https://en.wikipedia.org/wiki/Concentrated_solar_power",
  },
  {
    nodeId: "wind",
    title: "Wind Power",
    description: "Energy from wind via turbines (on/offshore)",
    link: "https://en.wikipedia.org/wiki/Wind_power",
    childrenNodes: ["onshore", "offshore"],
  },
  {
    nodeId: "onshore",
    title: "Onshore Wind",
    description: "Land‑based wind farms",
    link: null,
  },
  {
    nodeId: "offshore",
    title: "Offshore Wind",
    description: "Wind turbines in the sea",
    link: null,
  },
  {
    nodeId: "hydro",
    title: "Hydropower",
    description: "Electricity from flowing water (dams, tides)",
    link: "https://en.wikipedia.org/wiki/Hydroelectricity",
    childrenNodes: ["dams", "tidal"],
  },
  {
    nodeId: "dams",
    title: "Hydroelectric Dams",
    description: "Reservoir‑based power with low emissions",
    link: null,
  },
  {
    nodeId: "tidal",
    title: "Tidal & Marine",
    description: "Ocean tides and waves power generation",
    link: "https://en.wikipedia.org/wiki/Marine_energy",
  },
  {
    nodeId: "bio",
    title: "Bioenergy",
    description: "Energy from biomass, biofuels, waste",
    link: "https://en.wikipedia.org/wiki/Biofuel",
    childrenNodes: ["biomass", "biofuels"],
  },
  {
    nodeId: "biomass",
    title: "Biomass (wood, waste)",
    description: "Burned or decomposed for heat/electricity",
    link: null,
  },
  {
    nodeId: "biofuels",
    title: "Biofuels",
    description: "Liquid fuels like ethanol, biodiesel",
    link: null,
  },
  {
    nodeId: "emergingTech",
    title: "Emerging Technologies",
    description: "Growing or niche renewable methods",
    link: null,
    childrenNodes: ["geothermal", "hydrogen", "hybrid"],
  },
  {
    nodeId: "geothermal",
    title: "Geothermal Energy",
    description: "Heat from Earth’s interior for power and heating",
    link: "https://en.wikipedia.org/wiki/Geothermal_energy",
  },
  {
    nodeId: "hydrogen",
    title: "Renewable Hydrogen",
    description: "Green H₂ made via electrolysis from renewables",
    link: "https://en.wikipedia.org/wiki/Renewable_fuels",
  },
  {
    nodeId: "hybrid",
    title: "Hybrid Systems",
    description: "Combines multiple renewables + storage",
    link: "https://en.wikipedia.org/wiki/Hybrid_power",
  },
  {
    nodeId: "benefits",
    title: "Benefits",
    description: "Advantages of renewables",
    link: null,
    childrenNodes: ["lowCarbon", "renewable", "jobs", "energySecurity"],
  },
  {
    nodeId: "lowCarbon",
    title: "Low Carbon",
    description: "Produces minimal greenhouse gases",
    link: null,
  },
  {
    nodeId: "renewable",
    title: "Inexhaustible",
    description: "Sources naturally regenerate",
    link: null,
  },
  {
    nodeId: "jobs",
    title: "Job Creation",
    description: "Supports jobs in manufacturing & deployment",
    link: null,
  },
  {
    nodeId: "energySecurity",
    title: "Energy Security",
    description: "Reduces dependence on imported fossil fuels",
    link: null,
  },
  {
    nodeId: "challenges",
    title: "Challenges",
    description: "Barriers and downsides",
    link: null,
    childrenNodes: ["intermittency", "landUse", "cost", "materials"],
  },
  {
    nodeId: "intermittency",
    title: "Intermittency",
    description: "Variable output (sun/wind), needs storage",
    link: null,
  },
  {
    nodeId: "landUse",
    title: "Land & Ecosystem",
    description: "Habitat impact from dams, panels, turbines",
    link: null,
  },
  {
    nodeId: "cost",
    title: "High Up‑front Cost",
    description: "Initial CAPEX for infrastructure",
    link: null,
  },
  {
    nodeId: "materials",
    title: "Material/Mining Needs",
    description: "Mining for minerals, rare earths",
    link: null,
  },
];

export async function generateAIMindmap() {
  return new Promise<AIMindmap[]>((resolve) => {
    setTimeout(() => {
      resolve(SAMPLE_DATA);
    }, 5000);
  });
}
