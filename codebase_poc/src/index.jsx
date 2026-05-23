import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <React.StrictMode>
    {/* 
    
      
      To pass props, uncomment one of the cases below and comment out the default <App />:
      
      Hide all coaches (default - no props)
      
      CASE 1: Show all coaches on platform_1 and highlight coach 7 (green and bigger)
      <App platform="platform_1" coachNumber={3} />
      
      CASE 2: Show all coaches on platform_1 without highlighting
      <App platform="platform_4" />
      
      CASE 3: Show all coaches on local_platform_1
      <App platform="local_platform_1" />
      
      CASE 4: Show all coaches on all platforms
      <App showAllCoaches={true} />
      
     
    */}
    <App />

    {/* UNCOMMENT ONE OF THESE TO PASS PROPS TO THE APP COMPONENT: */}
    {/* <App platform="platform_3" coachNumber={12} /> */}
    {/* <App platform="platform_4" /> */}
    {/* <App platform="local_platform_1" /> */}
    {/* <App showAllCoaches={true} /> */}
  </React.StrictMode>
);
