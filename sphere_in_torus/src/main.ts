import { InitGPU, CreateGPUBuffer, CreateGPUBufferUint, CreateTransforms, CreateViewProjection, CreateAnimation } from './helper';
import { Shaders } from './shaders';
import { vec3, mat4, quat } from 'gl-matrix';
import { TorusWireframeData, SphereWireframeData } from './vertex_data';
import "./site.css";

const Create3DObject = async (isAnimation = true) => {
    const gpu = await InitGPU();
    const device = gpu.device;

    let R = 2, r = 0.5;
    let N = 20, n = 20;
    let torusColor: vec3 = vec3.fromValues(1, 0, 0);
    let sphereColor: vec3 = vec3.fromValues(0, 1, 0);
    let torusCenter: vec3 = [0, 0, 0], sphereCenter: vec3 = [0, 0, 0];
    let sphereRadius = r * 0.8;
    const torusWireframeData = TorusWireframeData(R, r, N, n, torusCenter, torusColor) as Float32Array;
    const sphereWireframeData = SphereWireframeData(sphereRadius, 20, 20, sphereCenter, sphereColor) as Float32Array;

    // Create vertex buffers
    const torusNumberOfVertices = torusWireframeData.length / 6;
    const torusVertexBuffer = CreateGPUBuffer(device, torusWireframeData);
    const sphereNumberOfVertices = sphereWireframeData.length / 6;
    const sphereVertexBuffer = CreateGPUBuffer(device, sphereWireframeData);

    const shader = Shaders();
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: shader.vertex
            }),
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: 24,
                    attributes: [
                        {
                            shaderLocation: 0,
                            format: "float32x3",
                            offset: 0
                        },
                        {
                            shaderLocation: 1,
                            format: "float32x3",
                            offset: 12
                        }
                    ]
                }
            ]
        },
        fragment: {
            module: device.createShaderModule({
                code: shader.fragment
            }),
            entryPoint: "fs_main",
            targets: [
                {
                    format: gpu.format
                }
            ]
        },
        primitive: {
            topology: "line-list",
        },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less"
        }
    });

    // Create uniform data
    const matrixSize = 4 * 16;
    const uniformOffset = 256;
    const uniformBufferSize = uniformOffset + matrixSize;
    let rotation = vec3.fromValues(0, 0, 0);

    const vp = CreateViewProjection(gpu.canvas.width / gpu.canvas.height);
    const modelMatrix1 = mat4.create();
    const translateMatrix1 = mat4.create();
    CreateTransforms(translateMatrix1, [0, 0, 0], [0, 0, 0], [1, 1, 1]);
    const modelViewProjectionMatrix1 = mat4.create() as Float32Array;

    const modelMatrix2 = mat4.create();
    const translateMatrix2 = mat4.create();
    const modelViewProjectionMatrix2 = mat4.create() as Float32Array;

    // Create uniform buffer and layout
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const uniformBindGroup1 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: {
                buffer: uniformBuffer,
                offset: 0,
                size: matrixSize
            }
        }]
    });

    const uniformBindGroup2 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: {
                buffer: uniformBuffer,
                offset: uniformOffset,
                size: matrixSize
            }
        }]
    });

    let textureView = gpu.context.getCurrentTexture().createView();
    const depthTexture = device.createTexture({
        size: [gpu.canvas.width, gpu.canvas.height, 1],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const renderPassDescription = {
        colorAttachments: [{
            view: textureView,
            clearValue: { r: 0.2, g: 0.247, b: 0.314, a: 1.0 }, // Background color
            loadOp: 'clear',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: "store",
        }
    };

    function draw() {

        // Transforms on the first object (torus)
        mat4.rotate(
            modelMatrix1,
            translateMatrix1,
            1,
            vec3.fromValues(Math.sin(2 * rotation[0]), Math.cos(2 * rotation[1]), 0)
        );
        mat4.multiply(modelViewProjectionMatrix1, vp.viewMatrix, modelMatrix1);
        mat4.multiply(modelViewProjectionMatrix1, vp.projectionMatrix, modelViewProjectionMatrix1);

       // Extract the rotation matrix from modelMatrix1
        const torusRotationQuat = quat.create();
        mat4.getRotation(torusRotationQuat, modelMatrix1);
        const torusRotationMatrix = mat4.create();
        mat4.fromQuat(torusRotationMatrix, torusRotationQuat);

        // Calculate the position of the sphere within the torus' tube
        const torusRadius = R; // Adjust this value based on the size of your torus
        const sphereAngle = performance.now() * 0.001; // Angle of the sphere's position within the tube
        const spherePosition = vec3.fromValues(
            (torusRadius) * Math.cos(2 * rotation[0]),
            0,
            (torusRadius) * Math.sin(2 * rotation[0]),
        );

        // Create a translation matrix for the sphere using the calculated position
        const sphereTranslationMatrix = mat4.create();
        mat4.fromTranslation(sphereTranslationMatrix, spherePosition);

        // Apply the torus' rotation to the sphere's translation matrix
        mat4.multiply(modelMatrix2, torusRotationMatrix, sphereTranslationMatrix);
        mat4.multiply(modelViewProjectionMatrix2, vp.viewMatrix, modelMatrix2);
        mat4.multiply(modelViewProjectionMatrix2, vp.projectionMatrix, modelViewProjectionMatrix2);

        device.queue.writeBuffer(
            uniformBuffer,
            0,
            modelViewProjectionMatrix1.buffer,
            modelViewProjectionMatrix1.byteOffset,
            modelViewProjectionMatrix1.byteLength
        );

        device.queue.writeBuffer(
            uniformBuffer,
            uniformOffset,
            modelViewProjectionMatrix2.buffer,
            modelViewProjectionMatrix2.byteOffset,
            modelViewProjectionMatrix2.byteLength
        );

        textureView = gpu.context.getCurrentTexture().createView();
        renderPassDescription.colorAttachments[0].view = textureView;
        const commandEncoder = device.createCommandEncoder();
        const renderPass = commandEncoder.beginRenderPass(renderPassDescription as GPURenderPassDescriptor);

        renderPass.setPipeline(pipeline);

        // Draw torus
        renderPass.setVertexBuffer(0, torusVertexBuffer);
        renderPass.setBindGroup(0, uniformBindGroup1);
        renderPass.draw(torusNumberOfVertices);

        // Draw sphere
        renderPass.setVertexBuffer(0, sphereVertexBuffer);
        renderPass.setBindGroup(0, uniformBindGroup2);
        renderPass.draw(sphereNumberOfVertices);

        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
    }

    CreateAnimation(draw, rotation, isAnimation);
}

Create3DObject();

window.addEventListener('resize', function () {
    Create3DObject();
});
