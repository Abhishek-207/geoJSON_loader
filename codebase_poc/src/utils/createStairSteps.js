function createTwoSidedStairSteps(
  feature,
  numSteps = 12,
  shouldColorLastStep = false,
  shouldColorThirdLastStep = false,
  shouldColorFirstSteps = false,
  touchesFOB = false
) {
  const coords = feature.geometry.coordinates[0];
  const [p1, p2, p3, p4] = coords.slice(0, 4);
  const baseProps = feature.properties;
  const totalHeight = baseProps.height || 8;
  const baseHeight = baseProps.base || 0;
  const stepFeatures = [];

  const interpolate = (p1, p2, ratio) => {
    return [p1[0] + (p2[0] - p1[0]) * ratio, p1[1] + (p2[1] - p1[1]) * ratio];
  };

  const addVector = (p, v, scale = 1) => {
    return [p[0] + v[0] * scale, p[1] + v[1] * scale];
  };

  const edge1Length = Math.sqrt(
    Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2)
  );
  const edge2Length = Math.sqrt(
    Math.pow(p3[0] - p2[0], 2) + Math.pow(p3[1] - p2[1], 2)
  );
  const edge3Length = Math.sqrt(
    Math.pow(p4[0] - p3[0], 2) + Math.pow(p4[1] - p3[1], 2)
  );
  const edge4Length = Math.sqrt(
    Math.pow(p1[0] - p4[0], 2) + Math.pow(p1[1] - p4[1], 2)
  );

  const edges = [
    { start: p1, end: p2, length: edge1Length, index: 0 },
    { start: p2, end: p3, length: edge2Length, index: 1 },
    { start: p3, end: p4, length: edge3Length, index: 2 },
    { start: p4, end: p1, length: edge4Length, index: 3 },
  ];
  edges.sort((a, b) => b.length - a.length);
  const longestEdge = edges[0];

  let widthVector;
  if (longestEdge.index === 0) {
    widthVector = [p4[0] - p1[0], p4[1] - p1[1]];
  } else if (longestEdge.index === 1) {
    widthVector = [p1[0] - p2[0], p1[1] - p2[1]];
  } else if (longestEdge.index === 2) {
    widthVector = [p2[0] - p3[0], p2[1] - p3[1]];
  } else {
    widthVector = [p3[0] - p4[0], p3[1] - p4[1]];
  }

  const stepsPerSide = numSteps;
  const stepThickness = Math.max((totalHeight / stepsPerSide) * 1.3, 0.5);
  const widthMultiplier = 3.5;
  const scaledWidthVector = [
    widthVector[0] * widthMultiplier,
    widthVector[1] * widthMultiplier,
  ];
  const zFightOffset = 0.6;

  for (let i = 0; i < stepsPerSide; i++) {
    const progress = (i / stepsPerSide) * 0.5;
    const nextProgress = ((i + 1) / stepsPerSide) * 0.5;

    const stepStart = interpolate(longestEdge.start, longestEdge.end, progress);
    const stepEnd = interpolate(
      longestEdge.start,
      longestEdge.end,
      nextProgress
    );

    const step_p1 = stepStart;
    const step_p2 = addVector(stepStart, scaledWidthVector);
    const step_p3 = addVector(stepEnd, scaledWidthVector);
    const step_p4 = stepEnd;

    if (stepsPerSide === 1) {
      var stepLevel = baseHeight + totalHeight * 0.5;
    } else {
      var stepLevel = baseHeight + (totalHeight * 0.5 * i) / (stepsPerSide - 1);
    }

    const isFirstStep = i === 0;
    const isSecondStep = i === 1;
    const isThirdStep = i === 2;
    const isLastStep = i === stepsPerSide - 1;
    const isSecondLastStep = i === stepsPerSide - 2;
    const isThirdLastStep = i === stepsPerSide - 3;

    const isFOBStep = touchesFOB && isLastStep;

    let stepBaseHeight;
    let stepTopHeight;
    if (isFOBStep) {
      const prevStepLevel =
        baseHeight + (totalHeight * 0.5 * (i - 1)) / (stepsPerSide - 1);
      stepBaseHeight = prevStepLevel;
      stepTopHeight = stepLevel + 0.02;
    } else if (isFirstStep) {
      stepBaseHeight = baseHeight + zFightOffset;
      const minStepThickness = 0.5;
      stepTopHeight = Math.max(stepLevel, stepBaseHeight + minStepThickness);
    } else {
      const prevStepLevel =
        baseHeight + (totalHeight * 0.5 * (i - 1)) / (stepsPerSide - 1);
      stepBaseHeight = prevStepLevel;
      stepTopHeight = stepLevel;
    }

    const isSpecialStaircase = [
      "staircase_1",
      "staircase_2",
      "staircase_3",
      "staircase_24",
      "staircase_25",
      "staircase_26",
      "staircase_27",
    ].includes(baseProps.id);
    const isLastOrSecondLast = isLastStep || isSecondLastStep;
    const isStaircase25Or26 = ["staircase_25", "staircase_26"].includes(
      baseProps.id
    );

    let stepColor;
    if (isFOBStep) {
      stepColor = "#59717d";
    } else if (
      isSpecialStaircase &&
      isLastOrSecondLast &&
      shouldColorLastStep
    ) {
      stepColor = "#808080";
    } else if (isStaircase25Or26 && isThirdStep && shouldColorFirstSteps) {
      stepColor = "#808080";
    } else if (
      (shouldColorLastStep && isLastOrSecondLast) ||
      (shouldColorThirdLastStep && isThirdLastStep) ||
      (shouldColorFirstSteps && (isFirstStep || isSecondStep || isThirdStep))
    ) {
      stepColor = "#c4c4c4";
    } else {
      stepColor = baseProps.color;
    }

    stepFeatures.push({
      type: "Feature",
      properties: {
        ...baseProps,
        id: `${baseProps.id}_side1_step_${i}`,
        base: stepBaseHeight,
        height: stepTopHeight,
        stepIndex: i,
        isStairStep: true,
        side: 1,
        color: stepColor,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[step_p1, step_p2, step_p3, step_p4, step_p1]],
      },
    });
  }

  for (let i = 0; i < stepsPerSide; i++) {
    const progress = 0.5 + (i / stepsPerSide) * 0.5;
    const nextProgress = 0.5 + ((i + 1) / stepsPerSide) * 0.5;

    const stepStart = interpolate(longestEdge.start, longestEdge.end, progress);
    const stepEnd = interpolate(
      longestEdge.start,
      longestEdge.end,
      nextProgress
    );

    const step_p1 = stepStart;
    const step_p2 = addVector(stepStart, scaledWidthVector);
    const step_p3 = addVector(stepEnd, scaledWidthVector);
    const step_p4 = stepEnd;

    if (stepsPerSide === 1) {
      var stepLevel = baseHeight + totalHeight * 0.5;
    } else {
      var stepLevel =
        baseHeight +
        (totalHeight * 0.5 * (stepsPerSide - 1 - i)) / (stepsPerSide - 1);
    }

    const isFirstStep = i === 0;
    const isSecondStep = i === 1;
    const isThirdStep = i === 2;
    const isLastStep = i === stepsPerSide - 1;
    const isSecondLastStep = i === stepsPerSide - 2;
    const isThirdLastStep = i === stepsPerSide - 3;

    const isFOBStep = touchesFOB && isFirstStep;

    let stepBaseHeight;
    let stepTopHeight;
    if (isFOBStep) {
      stepBaseHeight = stepLevel - stepThickness;
      stepTopHeight = stepLevel + 0.02;
    } else if (isLastStep) {
      const prevStepLevel =
        baseHeight +
        (totalHeight * 0.5 * (stepsPerSide - 1 - (i + 1))) / (stepsPerSide - 1);
      stepBaseHeight = Math.max(baseHeight + zFightOffset, prevStepLevel);
      const minStepThickness = 0.5;
      stepTopHeight = Math.max(
        stepLevel + zFightOffset,
        stepBaseHeight + minStepThickness
      );
    } else {
      const prevStepLevel =
        baseHeight +
        (totalHeight * 0.5 * (stepsPerSide - 1 - (i + 1))) / (stepsPerSide - 1);
      stepBaseHeight = prevStepLevel;
      stepTopHeight = stepLevel;
    }

    const isSpecialStaircase = [
      "staircase_1",
      "staircase_2",
      "staircase_3",
      "staircase_24",
      "staircase_25",
      "staircase_26",
      "staircase_27",
    ].includes(baseProps.id);
    const isLastOrSecondLast = isLastStep || isSecondLastStep;
    const isStaircase25Or26 = ["staircase_25", "staircase_26"].includes(
      baseProps.id
    );

    let stepColor;
    if (isFOBStep) {
      stepColor = "#59717d";
    } else if (
      isSpecialStaircase &&
      isLastOrSecondLast &&
      shouldColorLastStep
    ) {
      stepColor = "#808080";
    } else if (isStaircase25Or26 && isThirdStep && shouldColorFirstSteps) {
      stepColor = "#808080";
    } else if (
      (shouldColorLastStep && isLastOrSecondLast) ||
      (shouldColorThirdLastStep && isThirdLastStep) ||
      (shouldColorFirstSteps && (isFirstStep || isSecondStep || isThirdStep))
    ) {
      stepColor = "#c4c4c4";
    } else {
      stepColor = baseProps.color;
    }

    stepFeatures.push({
      type: "Feature",
      properties: {
        ...baseProps,
        id: `${baseProps.id}_side2_step_${i}`,
        base: stepBaseHeight,
        height: stepTopHeight,
        stepIndex: i,
        isStairStep: true,
        side: 2,
        color: stepColor,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[step_p1, step_p2, step_p3, step_p4, step_p1]],
      },
    });
  }

  return stepFeatures;
}

export function createStairSteps(feature, numSteps = 12) {
  if (!feature || feature.properties.type !== "stairs") {
    return [feature];
  }

  if (!feature.geometry || feature.geometry.type !== "Polygon") {
    return [feature];
  }

  const coords = feature.geometry.coordinates[0];
  if (coords.length < 4) {
    return [feature];
  }

  const baseProps = feature.properties;
  const totalHeight = baseProps.height || 8;
  const baseHeight = baseProps.base || 0;

  const shouldSplit = [
    "staircase_4",
    "staircase_6",
    "staircase_9",
    "staircase_10",
    "staircase_14",
  ].includes(baseProps.id);

  const shouldFlip = [
    "staircase_5",
    "staircase_7",
    "staircase_12",
    "staircase_20",
    "staircase_23",
    "staircase_25",
    "staircase_26",
  ].includes(baseProps.id);

  const lastStepColorStaircases = [
    "staircase_1",
    "staircase_2",
    "staircase_3",
    "staircase_8",
    "staircase_12",
    "staircase_17",
    "staircase_18",
    "staircase_19",
    "staircase_21",
    "staircase_22",
    "staircase_24",
    "staircase_27",
  ];
  const shouldColorLastStep = lastStepColorStaircases.includes(baseProps.id);

  const thirdLastStepColorStaircases = [];
  const shouldColorThirdLastStep = thirdLastStepColorStaircases.includes(
    baseProps.id
  );

  const firstStepsColorStaircases = [
    "staircase_7",
    "staircase_20",
    "staircase_23",
    "staircase_25",
    "staircase_26",
  ];
  const shouldColorFirstSteps = firstStepsColorStaircases.includes(
    baseProps.id
  );

  const fobTouchingStaircases = [
    "staircase_1",
    "staircase_2",
    "staircase_3",
    "staircase_8",
    "staircase_15",
    "staircase_17",
    "staircase_18",
    "staircase_19",
    "staircase_21",
    "staircase_22",
    "staircase_27",
  ];
  const touchesFOB = fobTouchingStaircases.includes(baseProps.id);

  if (shouldSplit) {
    return createTwoSidedStairSteps(
      feature,
      numSteps,
      shouldColorLastStep,
      shouldColorThirdLastStep,
      shouldColorFirstSteps,
      touchesFOB
    );
  }

  const stepFeatures = [];

  const [p1, p2, p3, p4] = coords.slice(0, 4);

  const edge1Length = Math.sqrt(
    Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2)
  );
  const edge2Length = Math.sqrt(
    Math.pow(p3[0] - p2[0], 2) + Math.pow(p3[1] - p2[1], 2)
  );
  const edge3Length = Math.sqrt(
    Math.pow(p4[0] - p3[0], 2) + Math.pow(p4[1] - p3[1], 2)
  );
  const edge4Length = Math.sqrt(
    Math.pow(p1[0] - p4[0], 2) + Math.pow(p1[1] - p4[1], 2)
  );

  const edges = [
    { start: p1, end: p2, length: edge1Length, index: 0 },
    { start: p2, end: p3, length: edge2Length, index: 1 },
    { start: p3, end: p4, length: edge3Length, index: 2 },
    { start: p4, end: p1, length: edge4Length, index: 3 },
  ];

  edges.sort((a, b) => b.length - a.length);
  const longestEdge = edges[0];

  const direction = [
    longestEdge.end[0] - longestEdge.start[0],
    longestEdge.end[1] - longestEdge.start[1],
  ];

  let widthVector;
  if (longestEdge.index === 0) {
    widthVector = [p4[0] - p1[0], p4[1] - p1[1]];
  } else if (longestEdge.index === 1) {
    widthVector = [p1[0] - p2[0], p1[1] - p2[1]];
  } else if (longestEdge.index === 2) {
    widthVector = [p2[0] - p3[0], p2[1] - p3[1]];
  } else {
    widthVector = [p3[0] - p4[0], p3[1] - p4[1]];
  }

  const addVector = (p, v, scale = 1) => {
    return [p[0] + v[0] * scale, p[1] + v[1] * scale];
  };

  const interpolate = (p1, p2, ratio) => {
    return [p1[0] + (p2[0] - p1[0]) * ratio, p1[1] + (p2[1] - p1[1]) * ratio];
  };

  const stepThickness = Math.max((totalHeight / numSteps) * 1.2, 0.5);
  const widthMultiplier = 3.5;
  const scaledWidthVector = [
    widthVector[0] * widthMultiplier,
    widthVector[1] * widthMultiplier,
  ];

  for (let i = 0; i < numSteps; i++) {
    const progress = i / numSteps;
    const nextProgress = (i + 1) / numSteps;

    const stepStart = interpolate(longestEdge.start, longestEdge.end, progress);
    const stepEnd = interpolate(
      longestEdge.start,
      longestEdge.end,
      nextProgress
    );

    const step_p1 = stepStart;
    const step_p2 = addVector(stepStart, scaledWidthVector);
    const step_p3 = addVector(stepEnd, scaledWidthVector);
    const step_p4 = stepEnd;

    const zFightOffset = 0.6;

    let stepLevel;
    if (shouldFlip) {
      stepLevel = baseHeight + totalHeight * (i / numSteps);
    } else {
      stepLevel = baseHeight + totalHeight * (1 - i / numSteps);
    }

    const isLastStep = i === numSteps - 1;
    const isSecondLastStep = i === numSteps - 2;
    const isThirdLastStep = i === numSteps - 3;
    const isFirstStep = i === 0;
    const isSecondStep = i === 1;
    const isThirdStep = i === 2;

    const isFOBStep =
      touchesFOB &&
      ((!shouldFlip && isFirstStep) || (shouldFlip && isLastStep));

    let stepBaseHeight;
    let stepTopHeight;
    if (isFOBStep) {
      if (shouldFlip) {
        const prevStepLevel = baseHeight + totalHeight * ((i - 1) / numSteps);
        stepBaseHeight = prevStepLevel;
      } else {
        const prevStepLevel =
          baseHeight + totalHeight * (1 - (i + 1) / numSteps);
        stepBaseHeight = prevStepLevel;
      }
      stepTopHeight = stepLevel + 0.02;
    } else if ((shouldFlip && isFirstStep) || (!shouldFlip && isLastStep)) {
      stepBaseHeight = baseHeight + zFightOffset;
      const minStepThickness = 0.5;
      stepTopHeight = Math.max(
        stepLevel + zFightOffset * 0.5,
        stepBaseHeight + minStepThickness
      );
    } else {
      stepBaseHeight = Math.max(stepLevel - stepThickness, baseHeight);
      stepTopHeight = stepLevel;
    }

    const isSpecialStaircase = [
      "staircase_1",
      "staircase_2",
      "staircase_3",
      "staircase_24",
      "staircase_25",
      "staircase_26",
      "staircase_27",
    ].includes(baseProps.id);
    const isLastOrSecondLast = isLastStep || isSecondLastStep;
    const isStaircase25Or26 = ["staircase_25", "staircase_26"].includes(
      baseProps.id
    );

    let stepColor;
    if (isFOBStep) {
      stepColor = "#59717d";
    } else if (
      isSpecialStaircase &&
      isLastOrSecondLast &&
      shouldColorLastStep
    ) {
      stepColor = "#808080";
    } else if (isStaircase25Or26 && isThirdStep && shouldColorFirstSteps) {
      stepColor = "#808080";
    } else if (
      (shouldColorLastStep && isLastOrSecondLast) ||
      (shouldColorThirdLastStep && isThirdLastStep) ||
      (shouldColorFirstSteps && (isFirstStep || isSecondStep || isThirdStep))
    ) {
      stepColor = "#c4c4c4";
    } else {
      stepColor = baseProps.color;
    }

    const stepFeature = {
      type: "Feature",
      properties: {
        ...baseProps,
        id: `${baseProps.id}_step_${i}`,
        base: stepBaseHeight,
        height: stepTopHeight,
        stepIndex: i,
        isStairStep: true,
        color: stepColor,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[step_p1, step_p2, step_p3, step_p4, step_p1]],
      },
    };

    stepFeatures.push(stepFeature);
  }

  return stepFeatures;
}

export function createEscalatorSteps(feature, numSteps = 12) {
  if (!feature || feature.properties.type !== "escalator") {
    return [feature];
  }

  if (!feature.geometry) {
    return [feature];
  }

  let polygonCoords;
  if (feature.geometry.type === "LineString") {
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) {
      return [feature];
    }

    const [start, end] = coords;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);

    const escalatorId = feature.properties.id || "";
    const isEscalator123 = [
      "escalator_1",
      "escalator_2",
      "escalator_3",
    ].includes(escalatorId);

    const rotatedDx = -dx;
    const rotatedDy = -dy;

    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;

    const rotatedStart = [midX - rotatedDx / 2, midY - rotatedDy / 2];
    const rotatedEnd = [midX + rotatedDx / 2, midY + rotatedDy / 2];

    let fobPoint, groundPoint;
    if (isEscalator123) {
      if (end[1] > start[1]) {
        fobPoint = rotatedEnd;
        groundPoint = rotatedStart;
      } else {
        fobPoint = rotatedStart;
        groundPoint = rotatedEnd;
      }
    } else {
      if (end[1] > start[1]) {
        fobPoint = rotatedStart;
        groundPoint = rotatedEnd;
      } else {
        fobPoint = rotatedEnd;
        groundPoint = rotatedStart;
      }
    }

    const baseWidth = 0.000001;
    const widthMultiplier = 3.5;

    const widthVectorX = -rotatedDy / length;
    const widthVectorY = rotatedDx / length;

    const scaledWidthX = widthVectorX * baseWidth * widthMultiplier;
    const scaledWidthY = widthVectorY * baseWidth * widthMultiplier;

    polygonCoords = [
      [groundPoint[0] + scaledWidthX, groundPoint[1] + scaledWidthY],
      [fobPoint[0] + scaledWidthX, fobPoint[1] + scaledWidthY],
      [fobPoint[0] - scaledWidthX, fobPoint[1] - scaledWidthY],
      [groundPoint[0] - scaledWidthX, groundPoint[1] - scaledWidthY],
      [groundPoint[0] + scaledWidthX, groundPoint[1] + scaledWidthY],
    ];
  } else if (feature.geometry.type === "Polygon") {
    polygonCoords = feature.geometry.coordinates[0];
    if (polygonCoords.length < 4) {
      return [feature];
    }
  } else {
    return [feature];
  }

  const baseProps = feature.properties;
  const totalHeight = baseProps.height || 8;
  const baseHeight = baseProps.base || 0;
  const stepFeatures = [];

  const [p1, p2, p3, p4] = polygonCoords.slice(0, 4);

  const interpolate = (p1, p2, ratio) => {
    return [p1[0] + (p2[0] - p1[0]) * ratio, p1[1] + (p2[1] - p1[1]) * ratio];
  };

  const addVector = (p, v, scale = 1) => {
    return [p[0] + v[0] * scale, p[1] + v[1] * scale];
  };

  const edge1Length = Math.sqrt(
    Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2)
  );
  const edge2Length = Math.sqrt(
    Math.pow(p3[0] - p2[0], 2) + Math.pow(p3[1] - p2[1], 2)
  );
  const edge3Length = Math.sqrt(
    Math.pow(p4[0] - p3[0], 2) + Math.pow(p4[1] - p3[1], 2)
  );
  const edge4Length = Math.sqrt(
    Math.pow(p1[0] - p4[0], 2) + Math.pow(p1[1] - p4[1], 2)
  );

  const edges = [
    { start: p1, end: p2, length: edge1Length, index: 0 },
    { start: p2, end: p3, length: edge2Length, index: 1 },
    { start: p3, end: p4, length: edge3Length, index: 2 },
    { start: p4, end: p1, length: edge4Length, index: 3 },
  ];
  edges.sort((a, b) => b.length - a.length);
  const longestEdge = edges[0];

  let widthVector;
  if (longestEdge.index === 0) {
    widthVector = [p4[0] - p1[0], p4[1] - p1[1]];
  } else if (longestEdge.index === 1) {
    widthVector = [p1[0] - p2[0], p1[1] - p2[1]];
  } else if (longestEdge.index === 2) {
    widthVector = [p2[0] - p3[0], p2[1] - p3[1]];
  } else {
    widthVector = [p3[0] - p4[0], p3[1] - p4[1]];
  }

  const stepThickness = Math.max((totalHeight / numSteps) * 1.3, 0.5);
  const widthMultiplier = 3.5;
  const scaledWidthVector = [
    widthVector[0] * widthMultiplier,
    widthVector[1] * widthMultiplier,
  ];
  const zFightOffset = 0.6;

  const escalatorColor = "#006400";
  const fobColor = "#59717d";
  const platformColor = "#808080";

  const escalatorId = baseProps.id || "";
  const isEscalator4 = escalatorId === "escalator_4";
  const startStep = isEscalator4 ? 1 : 0;

  for (let i = startStep; i < numSteps; i++) {
    const progress = i / numSteps;
    const nextProgress = (i + 1) / numSteps;

    const stepStart = interpolate(longestEdge.start, longestEdge.end, progress);
    const stepEnd = interpolate(
      longestEdge.start,
      longestEdge.end,
      nextProgress
    );

    const step_p1 = stepStart;
    const step_p2 = addVector(stepStart, scaledWidthVector);
    const step_p3 = addVector(stepEnd, scaledWidthVector);
    const step_p4 = stepEnd;

    const stepIndex = isEscalator4 ? i - 2 : i;
    const isFirstStep = stepIndex === 0;
    const isSecondStep = stepIndex === 1;
    const isLastStep = i === numSteps - 1;

    let stepLevel;
    if (numSteps === 1) {
      stepLevel = baseHeight + totalHeight * 0.5;
    } else {
      stepLevel = baseHeight + (totalHeight * i) / (numSteps - 1);
    }

    let stepBaseHeight;
    let stepTopHeight;
    if (isFirstStep && !isEscalator4) {
      stepBaseHeight = baseHeight + zFightOffset;
      const minStepThickness = 0.5;
      stepTopHeight = Math.max(stepLevel, stepBaseHeight + minStepThickness);
    } else {
      const prevStepLevel =
        baseHeight + (totalHeight * (i - 1)) / (numSteps - 1);
      stepBaseHeight = prevStepLevel;
      stepTopHeight = stepLevel;
    }

    const isEscalator1Or5 = ["escalator_1", "escalator_5"].includes(
      escalatorId
    );

    let stepColor;
    if (isLastStep) {
      stepColor = fobColor;
    } else if (isEscalator1Or5 && (isFirstStep || isSecondStep)) {
      stepColor = platformColor;
    } else {
      stepColor = escalatorColor;
    }

    const stepFeature = {
      type: "Feature",
      properties: {
        ...baseProps,
        id: `${baseProps.id}_step_${stepIndex}`,
        base: stepBaseHeight,
        height: stepTopHeight,
        stepIndex: stepIndex,
        isEscalatorStep: true,
        color: stepColor,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[step_p1, step_p2, step_p3, step_p4, step_p1]],
      },
    };

    stepFeatures.push(stepFeature);
  }

  return stepFeatures;
}

export function processStaircases(geojsonData, numSteps = 12) {
  if (!geojsonData || !geojsonData.features) {
    return geojsonData;
  }

  const staircasesToRemove = [
    "staircase_4",
    "staircase_5",
    "staircase_6",
    "staircase_9",
    "staircase_10",
    "staircase_12",
    "staircase_13",
    "staircase_14",
  ];

  const processedFeatures = [];

  geojsonData.features.forEach((feature) => {
    if (
      feature.properties &&
      feature.properties.type === "stairs" &&
      staircasesToRemove.includes(feature.properties.id)
    ) {
      return;
    }

    if (feature.properties && feature.properties.type === "stairs") {
      const steps = createStairSteps(feature, numSteps);
      processedFeatures.push(...steps);
    } else if (feature.properties && feature.properties.type === "escalator") {
      const steps = createEscalatorSteps(feature, numSteps);
      processedFeatures.push(...steps);
    } else {
      processedFeatures.push(feature);
    }
  });

  return {
    ...geojsonData,
    features: processedFeatures,
  };
}
