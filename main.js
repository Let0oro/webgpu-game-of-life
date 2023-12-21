import './style.css'

const GRID_SIZE = 4; // tamaño de cuadrícula
const canvas = document.querySelector("canvas");

// Asegúrate de que se puede acceder a WebGPU
if (!navigator.gpu) {
  throw new Error("WebGPU not supported on this browser.");
}

// Solicitar adaptador de dispositivo
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  throw new Error("No appropriate GPUAdapter found.");
}

// Solicitar el device de GPU
const device = await adapter.requestDevice();

// Configurar el lienzo
const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device: device,
  format: canvasFormat,
});

// Definir los vértices con un TypedArray Float32 con todas las posiciones de los vértices del diagrama
// La GPU funciona con líneas, puntos o triángulos, usamos triángulos, así que definiremos dos para hacer un cuadrado
const vertices = new Float32Array([
  //   X,    Y,
    -0.8, -0.8, // Triangle 1
     0.8, -0.8,
     0.8,  0.8,

    -0.8, -0.8, // Triangle 2
     0.8,  0.8,
    -0.8,  0.8,
  ]);

// Crear un Buffer de vértices
//? Buffer -> Bloque de memoria al que la GPU puede acceder con facilidad y que se marca para determinados fines. Como un TypedArray visible en la GPU.
const vertexBuffer = device.createBuffer({
  label: "Cell vertices", // Etiqueta que identificará al Buffer en los mensajes de error
  size: vertices.byteLength, // Auto, resultado de tamaño de número float de 32 bits (4 bytes) * nº flotantes en array (12) = 48
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, // Uso del buffer -> para datos de vértices y copie datos
});
//? Este buffer es de difícil acceso, aunque se puede cambiar el contenido de su memoria

// Para cambiar datos de vértices en la memoria del buffer:
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);


// Define el diseño de vértices con un diccionario de GPUVertexBufferLayout
const vertexBufferLayout = {
  arrayStride: 8, // Cantidad de bytes que la GPU ha de saltar por cada vértice que busca 2*Float32(4bytes)
  attributes: [{ // Por cada vértice
    format: "float32x2", // Proviene de GPUVertexFormat, dos números de Float32
    offset: 0, // cuántos bytes empiezan en el vértice de este atributo
    shaderLocation: 0, // Position between 0-15, unique for each attribute, vincula a entrada de sombreador de vértices
  }],
};

// Sombreadores son pequeños programas que escribes y que se ejecutan en tu GPU. Cada sombreador opera en una etapa diferente de los datos: procesamiento de Vertex, de fragmentos o procesamiento general.
// Se escriben en un lenguaje llamado WGSL, se pasan a WebGPU como cadenas
const cellShaderModule = device.createShaderModule({
  label: "Cell shader",
  code: `
  // Your shader code will go here


  // Accede a los uniformes en un sombreador
  // At the top of the 'code' string in the createShaderModule() call
  @group(0) @binding(0) var<uniform> grid: vec2f;
  
  @vertex
  fn vertexMain(@location(0) pos: vec2f) ->
    @builtin(position) vec4f {
    return vec4f(pos / grid, 0, 1);
  }
  
  // ...fragmentMain is unchanged 

// -------------------------------------------------------
  
  // Define el sombreador de vértices, que será llamado por la GPU por cada vértice del VertexBuffer
  // Ha de devolver un vector de 4 dimensiones con la posición final del vértice
/*
@vertex // define la etapa de sombreado
fn vertexMain( @location(0) pos: vec2f ) 
  //usando los datos de localización del buffer como argumentos: 0-> shaderLocation, vec2f -> 2D format float32x2
  -> @builtin(position) vec4f 
  {
    // return vec4f(0, 0, 0, 1); // (X, Y, Z, W)
    // return vec4f(pos.x, pos.y, 0, 1); // Para pasar de un vector 2D a 4D, igual a lo siguiente
    return vec4f(pos, 0, 1); // grid -> vector de número de punto flotante 2D que coincide con el array del búfer uniforme
}
*/

// -------------------------------------------------------

  // Define el sombreador de fragmentos, similar a sombreador de vértices, pero por cada pixel en vez de vértice
  // Siempre se llaman después de estos
  // También devuelve un vector 4D, pero este define el color, no la posición
@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1, 0, 0, 1); // (Red, Green, Blue, Alpha)
}
  `
});


// Crea una canalización de renderizaciones -> controla cómo se dibuja la geometría, cómo interpretar datos de bufferes, tipo de geometría, etc
//! Objeto más complicado
const cellPipeline = device.createRenderPipeline({
  label: "Cell pipeline",
  layout: "auto", // describe los tipos de entrada que necesita canalización
  vertex: {
    module: cellShaderModule, // GPUShaderModule que contiene sombreador de vértices
    entryPoint: "vertexMain", // Asigna el nombre de la función en el código del sombreador que se llama para cada invocación del vértice.
    buffers: [vertexBufferLayout] // Array de objetos GPUVertexBufferLayout que describen cómo tus datos se empaquetan en los búferes de vértices con los que se usa esta canalización
  },
  fragment: {
    module: cellShaderModule, // GPUShaderModule que contiene sombreador de fragmentos
    entryPoint: "fragmentMain", // Asigna el nombre de la función en el código del sombreador que se llama para cada invocación del fragmento.
    targets: [{
      format: canvasFormat // format de textura o adjuntos de color, usa el formato del contexto del canvas
    }]
  }
});

// Crea un buffer uniforme que describa el grid
const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
const uniformBuffer = device.createBuffer({
  label: "Grid Uniforms",
  size: uniformArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformBuffer, 0, uniformArray);


// Crea un grupo de vinculaciones -> conecta buffer con el uniforme en el sombreador
const bindGroup = device.createBindGroup({
  label: "Cell renderer bind group",
  layout: cellPipeline.getBindGroupLayout(0), // tipos de recursos que contiene este grupo de vinculaciones, 0 como 0 en el @group(0) del código de sombreador
  entries: [{
    binding: 0, // igual al escogido por el @binding(0) del sombreador
    resource: { buffer: uniformBuffer } //  recurso real para exponer a la variable en el índice de vinculación especificado
  }],
}); // has creado un GPUBindGroup, inmutable y opaco, pero se pueden cambiar los contenidos de los recursos





// Borrar el lienzo
//    Solicitar encoder para grabar comandos de GPU y proporcione pases de renderización
const encoder = device.createCommandEncoder();

//    Obtener textura del contexto con colores personalizados
const pass = encoder.beginRenderPass({
  colorAttachments: [{
     view: context.getCurrentTexture().createView(),
     loadOp: "clear",
     storeOp: "store",
     clearValue: { r: 0, g: 0, b: 0.4, a: 1 }, // New line
  }]
});


// Dibujar el cuadrado
// // After encoder.beginRenderPass()
// pass.setPipeline(cellPipeline); // indica con qué canalización se debe dibujar
// pass.setVertexBuffer(0, vertexBuffer); // buffer que contiene los vértices del cuadrado, se llama a 0 por ser el primero
// pass.draw(vertices.length / 2); // 6 vertices - cantidad de vértices que se deben renderizar, los cuales se extraen de los búferes de vértices configurados 
// // before pass.end()


// Vincula el grupo de vinculaciones -> decirle a WebGPU que lo use cuando dibuje, *comentando lo anterior*
pass.setPipeline(cellPipeline);
pass.setVertexBuffer(0, vertexBuffer);

pass.setBindGroup(0, bindGroup); // New line!

pass.draw(vertices.length / 2);



pass.end();

//    Obtener buffer de comandos
const commandBuffer = encoder.finish();

//    Hacer que el buffer ejecute todos los comandos de la GPU en cola
device.queue.submit([commandBuffer]);
// también se puede usar -> device.queue.submit([encoder.finish()]); ya que una vez llamado, has de crear otro bufer y obtener otra textura del contexto






