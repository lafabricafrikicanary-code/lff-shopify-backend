(()=>{"use strict";
  for(const group of document.querySelectorAll(".lffNativePilot .lffNativeGroup")){
    const button=group.querySelector(".lffNativeMore");
    const template=group.querySelector(".lffNativePending");
    const grid=group.querySelector(".lffNativeGrid");
    if(!button||!template||!grid)continue;
    button.addEventListener("click",()=>{
      let added=0;
      while(template.content.firstElementChild&&added<12){
        const card=template.content.firstElementChild;
        grid.appendChild(card);
        added++;
      }
      const remaining=template.content.children.length;
      if(!remaining){template.remove();button.remove();}
      else button.textContent="Ver más · "+remaining+" artículos";
    });
  }
})();