export function filterCoachesAndEngines(stationData, props = {}) {
  const { platform = "", coachNumber = null, showAllCoaches = false } = props;

  // If showAllCoaches is true, show all coaches from all platforms
  if (showAllCoaches) {
    // Filter to get all coaches and engines from all platforms
    const filteredFeatures = stationData.features.filter((feature) => {
      const featureType = feature.properties?.type;
      return featureType === "coach" || featureType === "engine";
    });

    // Process features and highlight the specified coach (if coachNumber is provided)
    const processedFeatures = filteredFeatures.map((feature) => {
      const featureType = feature.properties?.type;
      const featureCoachNumber = feature.properties?.coachNumber;
      const featurePlatform = feature.properties?.platform;

      // Deep copy to avoid mutating original data
      const processedFeature = {
        type: feature.type,
        geometry: {
          type: feature.geometry?.type,
          coordinates: feature.geometry?.coordinates
            ? JSON.parse(JSON.stringify(feature.geometry.coordinates))
            : feature.geometry?.coordinates,
        },
        properties: {
          ...feature.properties,
        },
      };

      // Highlight matching coach (if coachNumber is provided)
      if (
        featureType === "coach" &&
        coachNumber !== null &&
        coachNumber !== undefined &&
        featureCoachNumber === coachNumber
      ) {
        processedFeature.properties.color = "#00FF00";
        processedFeature.properties.isHighlighted = true;
        processedFeature.properties.originalColor = feature.properties.color;
      } else if (featureType === "coach") {
        // Remove highlight flag from non-matching coaches
        if (processedFeature.properties.isHighlighted !== undefined) {
          delete processedFeature.properties.isHighlighted;
        }
      }

      if (
        !processedFeature.geometry ||
        !processedFeature.geometry.coordinates
      ) {
        console.warn(
          "⚠️ Invalid geometry for feature:",
          processedFeature.properties?.id
        );
      }

      return processedFeature;
    });

    return {
      type: "FeatureCollection",
      features: processedFeatures,
    };
  }

  // Return empty if no platform specified
  if (!platform || platform.trim() === "") {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  // Filter to get only coaches and engines for the specified platform
  const filteredFeatures = stationData.features.filter((feature) => {
    const featureType = feature.properties?.type;
    const featurePlatform = feature.properties?.platform;

    if (
      (featureType === "coach" || featureType === "engine") &&
      featurePlatform === platform
    ) {
      return true;
    }
    return false;
  });

  // Process features and highlight the specified coach
  const processedFeatures = filteredFeatures.map((feature) => {
    const featureType = feature.properties?.type;
    const featureCoachNumber = feature.properties?.coachNumber;

    const processedFeature = {
      type: feature.type,
      geometry: {
        type: feature.geometry?.type,
        coordinates: feature.geometry?.coordinates
          ? JSON.parse(JSON.stringify(feature.geometry.coordinates))
          : feature.geometry?.coordinates,
      },
      properties: {
        ...feature.properties,
      },
    };

    // Highlight matching coach
    if (
      featureType === "coach" &&
      coachNumber !== null &&
      coachNumber !== undefined &&
      featureCoachNumber === coachNumber
    ) {
      processedFeature.properties.color = "#00FF00";
      processedFeature.properties.isHighlighted = true;
      processedFeature.properties.originalColor = feature.properties.color;
    } else if (featureType === "coach") {
      // Remove highlight flag from non-matching coaches
      if (processedFeature.properties.isHighlighted !== undefined) {
        delete processedFeature.properties.isHighlighted;
      }
    }

    if (!processedFeature.geometry || !processedFeature.geometry.coordinates) {
      console.warn(
        "⚠️ Invalid geometry for feature:",
        processedFeature.properties?.id
      );
    }

    return processedFeature;
  });

  return {
    type: "FeatureCollection",
    features: processedFeatures,
  };
}

// Check if props contain a valid platform or showAllCoaches flag
export function hasValidCoachProps(props = {}) {
  const { platform = "", showAllCoaches = false } = props;
  return (platform && platform.trim() !== "") || showAllCoaches;
}
