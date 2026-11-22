/* LIREP QA258 — Material institucional offline, blanco predominante.
   No envía URLs, datos, QR ni imágenes a terceros. El QR se calcula en el navegador.
   Copyright 360 Integral Solutions. QR encoder local: Project Nayuki (MIT).
*/
(() => {
  "use strict";
  const root=document.getElementById("lirep-material");
  if(!root)return;
  const url=root.dataset.publicUrl||"";
  const name=root.dataset.company||"Empresa";
  const state=root.querySelector("[data-material-status]");
  const buttons=[...root.querySelectorAll("[data-material-download]")];
  const preview=root.querySelector("[data-material-preview]");
  const validUrl=()=>{
    try {
      const u=new URL(url);
      return u.protocol==="https:" && !u.username && !u.password && !u.hash;
    } catch {return false;}
  };
  const setStatus=t=>{if(state)state.textContent=t;};
  const download=(blob,filename)=>{
    const a=document.createElement("a"),href=URL.createObjectURL(blob);
    a.href=href;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(href),2000);
  };
  const pad=(ctx,x,y,w,h)=>{ctx.fillStyle="#fff";ctx.fillRect(x,y,w,h);};
  const qrSize=()=>{
    if(typeof qrcodegen==="undefined")throw Error("No se pudo cargar el generador QR local.");
    return qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.QUARTILE);
  };
  const drawQR=(canvas,pixels=1000)=>{
    const qr=qrSize(),quiet=4,modules=qr.size+quiet*2;
    const cell=Math.max(1,Math.floor(pixels/modules)),size=modules*cell;
    canvas.width=size;canvas.height=size;
    const c=canvas.getContext("2d");
    if(!c)throw Error("No hay soporte de imagen en este navegador.");
    c.imageSmoothingEnabled=false;pad(c,0,0,size,size);
    c.fillStyle="#14253e";
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)
      if(qr.getModule(x,y))c.fillRect((x+quiet)*cell,(y+quiet)*cell,cell,cell);
    return canvas;
  };
  const qrCanvas=document.createElement("canvas");
  const poster=document.createElement("canvas");
  const w=1240,h=1754;
  const lines=(ctx,txt,maxWidth)=>{
    const words=txt.split(/\s+/),out=[];let line="";
    for(const word of words){
      const attempt=line?line+" "+word:word;
      if(ctx.measureText(attempt).width>maxWidth&&line){out.push(line);line=word}
      else line=attempt;
    }
    if(line)out.push(line);return out;
  };
  const posterCanvas=()=>{
    const qr=drawQR(qrCanvas,950);
    poster.width=w;poster.height=h;
    const c=poster.getContext("2d");
    if(!c)throw Error("No hay soporte de imagen en este navegador.");
    pad(c,0,0,w,h);
    c.strokeStyle="#dce2ea";c.lineWidth=3;c.strokeRect(52,52,w-104,h-104);
    c.fillStyle="#14253e";c.textAlign="center";
    c.font="bold 27px system-ui, sans-serif";
    c.fillText("ATENCIÓN AL CONSUMIDOR",w/2,204);
    c.font="bold 66px system-ui, sans-serif";
    c.fillText("LIBRO DE",w/2,310);
    c.fillText("RECLAMACIONES",w/2,384);
    c.strokeStyle="#dce2ea";c.lineWidth=2;
    c.beginPath();c.moveTo(180,432);c.lineTo(w-180,432);c.stroke();
    c.font="600 32px system-ui, sans-serif";
    let y=510;for(const l of lines(c,name.toLocaleUpperCase("es-PE"),970).slice(0,3)){c.fillText(l,w/2,y);y+=48;}
    const side=665; c.drawImage(qr,(w-side)/2,645,side,side);
    c.fillStyle="#263950";c.font="bold 33px system-ui, sans-serif";
    c.fillText("Escanea para registrar tu",w/2,1377);
    c.fillText("reclamo o queja",w/2,1424);
    c.fillStyle="#506078";c.font="25px system-ui, sans-serif";
    c.fillText("Puedes solicitar ayuda al personal del establecimiento.",w/2,1493);
    c.font="20px system-ui, sans-serif";
    const visible=new URL(url),display=visible.hostname+visible.pathname;
    let ty=1560;for(const l of lines(c,display,1000).slice(0,3)){c.fillText(l,w/2,ty);ty+=32;}
    c.font="18px system-ui, sans-serif";c.fillText("Acceso gratuito · LIREP",w/2,1668);
    return poster;
  };
  const makeBlob=(canvas,type,quality)=>new Promise((resolve,reject)=>
    canvas.toBlob(blob=>blob?resolve(blob):reject(Error("No se pudo generar la imagen.")),type,quality));
  const makeSvg=()=>{
    const qr=qrSize(),quiet=4,size=qr.size+quiet*2;
    let cells="";
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)
      if(qr.getModule(x,y))cells+='<rect x="'+(x+quiet)+'" y="'+(y+quiet)+'" width="1" height="1"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#14253e">'+cells+'</g></svg>';
  };
  // One-page A4 PDF containing a JPEG A4 raster, no CDN or print dialog.
  const pdfFromJpeg=async(canvas)=>{
    const jpeg=new Uint8Array(await (await makeBlob(canvas,"image/jpeg",.92)).arrayBuffer());
    const encoder=new TextEncoder(),chunks=[],offsets=[0],length={n:0};
    const append=bytes=>{chunks.push(bytes);length.n+=bytes.length;};
    const ascii=str=>append(encoder.encode(str));
    const obj=(n,body)=>{offsets[n]=length.n;ascii(n+" 0 obj\n"+body+"\nendobj\n");};
    ascii("%PDF-1.4\n");
    obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
    obj(2,"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3,"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    offsets[4]=length.n;
    ascii("4 0 obj\n<< /Type /XObject /Subtype /Image /Width "+canvas.width+" /Height "+canvas.height+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpeg.length+" >>\nstream\n");
    append(jpeg);ascii("\nendstream\nendobj\n");
    const stream="q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
    obj(5,"<< /Length "+encoder.encode(stream).length+" >>\nstream\n"+stream+"endstream");
    const xref=length.n;
    ascii("xref\n0 6\n0000000000 65535 f \n");
    for(let i=1;i<=5;i++)ascii(String(offsets[i]).padStart(10,"0")+" 00000 n \n");
    ascii("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n");
    return new Blob(chunks,{type:"application/pdf"});
  };
  try {
    if(!validUrl())throw Error("Publica primero una página HTTPS con el formulario LIREP.");
    posterCanvas();
    if(preview){preview.src=poster.toDataURL("image/png");preview.hidden=false;}
    buttons.forEach(b=>b.disabled=false);
    setStatus("Material preparado para esta empresa. Antes de exhibirlo, prueba el QR con un teléfono.");
  } catch(error){buttons.forEach(b=>b.disabled=true);setStatus(error.message);}
  root.addEventListener("click",async(event)=>{
    const button=event.target.closest("[data-material-download]");
    if(!button||button.disabled)return;
    button.disabled=true;
    try{
      const kind=button.dataset.materialDownload,slug="lirep-"+(root.dataset.prefix||"empresa").toLowerCase();
      if(kind==="qr-png")download(await makeBlob(drawQR(qrCanvas,1000),"image/png"),slug+"-qr.png");
      if(kind==="qr-svg")download(new Blob([makeSvg()],{type:"image/svg+xml"}),slug+"-qr.svg");
      if(kind==="poster-png")download(await makeBlob(posterCanvas(),"image/png"),slug+"-aviso.png");
      if(kind==="poster-pdf")download(await pdfFromJpeg(posterCanvas()),slug+"-aviso-a4.pdf");
    }catch(error){setStatus("No se pudo descargar el archivo: "+error.message);}
    finally{button.disabled=false}
  });
})();
