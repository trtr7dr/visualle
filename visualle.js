"use strict";
import * as THREE from './three/build/three.module.js';

import { TrackballControls } from './three/jsm/controls/TrackballControls.js';
import { GLTFLoader } from './three/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from './three/jsm/loaders/RGBELoader.js';
import { DDSLoader } from './three/jsm/loaders/DDSLoader.js';


import { EffectComposer } from './three/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './three/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './three/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from './three/jsm/postprocessing/AfterimagePass.js';
import { FilmPass } from './three/jsm/postprocessing/FilmPass.js';
import { BokehPass } from './three/jsm/postprocessing/BokehPass.js';


import { ShaderPass } from './three/jsm/postprocessing/ShaderPass.js';
import { LuminosityShader } from './three/jsm/shaders/LuminosityShader.js';
import { SobelOperatorShader } from './three/jsm/shaders/SobelOperatorShader.js';


class ResourceTracker {
    constructor() {

        this.resources = new Set();
    }
    track(resource) {
        if (!resource) {
            return resource;
        }
        if (Array.isArray(resource)) {
            resource.forEach(resource => this.track(resource));
            return resource;
        }
        if (resource.dispose || resource instanceof THREE.Object3D) {
            this.resources.add(resource);
        }
        if (resource instanceof THREE.Object3D) {
            this.track(resource.geometry);
            this.track(resource.material);
            this.track(resource.children);
        } else if (resource instanceof THREE.Material) {
            for (const value of Object.values(resource)) {
                if (value instanceof THREE.Texture) {
                    this.track(value);
                }
            }
            if (resource.uniforms) {
                for (const value of Object.values(resource.uniforms)) {
                    if (value) {
                        const uniformValue = value.value;
                        if (uniformValue instanceof THREE.Texture ||
                                Array.isArray(uniformValue)) {
                            this.track(uniformValue);
                        }
                    }
                }
            }
        }
        return resource;
    }

    untrack(resource) {
        this.resources.delete(resource);
    }

    disposeNode(node) {
        if (node.geometry) {
            node.geometry.dispose();
        }
        if (node.material) {
            var materialArray;
            if (node.material instanceof THREE.MeshFaceMaterial || node.material instanceof THREE.MultiMaterial) {
                materialArray = node.material.materials;
            } else if (node.material instanceof Array) {
                materialArray = node.material;
            }
            if (materialArray) {
                materialArray.forEach(function (mtrl, idx) {
                    if (mtrl.map)
                        mtrl.map.dispose();
                    if (mtrl.lightMap)
                        mtrl.lightMap.dispose();
                    if (mtrl.bumpMap)
                        mtrl.bumpMap.dispose();
                    if (mtrl.normalMap)
                        mtrl.normalMap.dispose();
                    if (mtrl.specularMap)
                        mtrl.specularMap.dispose();
                    if (mtrl.envMap)
                        mtrl.envMap.dispose();
                    mtrl.dispose();
                });
            } else {
                if (node.material.map)
                    node.material.map.dispose();
                if (node.material.lightMap)
                    node.material.lightMap.dispose();
                if (node.material.bumpMap)
                    node.material.bumpMap.dispose();
                if (node.material.normalMap)
                    node.material.normalMap.dispose();
                if (node.material.specularMap)
                    node.material.specularMap.dispose();
                if (node.material.envMap)
                    node.material.envMap.dispose();
                node.material.dispose();
            }
        }
        if (node.dispose) {
            node.dispose();
        }
    }

    dispose() {
        this.main = vAlee.scene;

        for (let i = 0; i < this.main.children.length; i++) {
            this.disposeNode(this.main.children[i]);
            this.main.remove(this.main.children[i]);
        }
        for (const resource of this.resources) {
            if (resource instanceof THREE.Object3D) {
                if (resource.parent) {
                    resource.parent.remove(resource);
                }
                if (Boolean(resource.material)) {
                    resource.material.dispose();
                    resource.remove(resource.material);
                }
                if (Boolean(resource.geometry)) {
                    resource.geometry.dispose();
                    resource.remove(resource.geometry);
                }
                if (Boolean(resource.texture)) {
                    resource.texture.dispose();
                    resource.remove(resource.texture.geometry);
                }
            }
            if (resource.dispose) {
                resource.dispose();
            }
        }
        this.resources.clear();
    }
}

class AudioStream {

    constructor() {
        this.data = [];

        this.liner = 0;

        for (let i = 0; i < 16; i++) {
            this.data[i] = 100 - i * 10;
        }

        navigator.getUserMedia = navigator.getUserMedia ||
                navigator.webkitGetUserMedia ||
                navigator.mozGetUserMedia;
        let self = this;
        if (navigator.getUserMedia) {
            navigator.getUserMedia({
                audio: true
            },
                    function (stream) {
                        let audioContext = new AudioContext();
                        let analyser = audioContext.createAnalyser();
                        let microphone = audioContext.createMediaStreamSource(stream);
                        let javascriptNode = audioContext.createScriptProcessor(256, 2, 1);

                        analyser.smoothingTimeConstant = 0.8;
                        analyser.fftSize = 32;

                        microphone.connect(analyser);
                        analyser.connect(javascriptNode);
                        javascriptNode.connect(audioContext.destination);


                        javascriptNode.onaudioprocess = function () {
                            var array = new Uint8Array(analyser.frequencyBinCount);
                            analyser.getByteFrequencyData(array);
                            self.data = array;

                        }
                    },
                    function (err) {
                        console.log("The following error occured: " + err.name)
                    });
        } else {
            console.log("getUserMedia not supported");
        }
    }

    get() {
        return this.data;
    }

    get_by_index(i) {
        return this.data[i];
    }

    get_next() {
        this.liner = (this.liner > 15) ? 0 : this.liner++;
        return this.data[this.liner];
    }
}


class RandMesher {

    constructor() {
        this.res = false;
        this.mode = {
            0: 'sphere',
            1: 'cube',
            2: 'gltf'
        };
        this.constants();
        this.add_shader();

        this.loader = new GLTFLoader();
        this.loader.setDDSLoader(new DDSLoader());
    }

    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min)) + min; //Максимум не включается, минимум включается
    }

    constants() {
        this.displacement_count = 25000;

        this.textures = 13;
    }

    async gltf_get() {
        let custom_mesh = await this.loader.loadAsync('models/' + this.getRandomInt(1, 3) + '.gltf');
        custom_mesh = custom_mesh.scene.children[0];

        custom_mesh.material = this.shaderMaterial;
        custom_mesh.geometry.setAttribute('displacement', tracker.track(new THREE.BufferAttribute(this.displacement, 1)));
        custom_mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(custom_mesh.geometry.attributes.position.array, 3));

        this.displacement_count = custom_mesh.geometry.attributes.displacement.count;

        this.res = custom_mesh;

        return this.res;
    }

    add_shader() {
        this.texture = tracker.track(new THREE.TextureLoader().load('image/texture/' + this.getRandomInt(1, this.textures) + '.jpg'));

        this.uniforms = {

            'amplitude': {value: 1.0},
            'color': {value: new THREE.Color(0xffff00)},
            'colorTexture': {value: this.texture}

        };

        this.uniforms[ 'colorTexture' ].value.wrapS = this.uniforms[ 'colorTexture' ].value.wrapT = tracker.track(THREE.RepeatWrapping);

        let wf = (Math.random() > 0.5) ? true : false;
        this.shaderMaterial = tracker.track(new THREE.ShaderMaterial({
            wireframe: wf,
            transparent: true,
            metalness: 2,
            envMapIntensity: 5,
            uniforms: this.uniforms,
            vertexShader: document.getElementById('vertexshader').textContent,
            fragmentShader: document.getElementById('fragmentshader').textContent
        }));
    }

    get() {
        this.displacement = tracker.track(new Float32Array(this.displacement_count));
        this.noise = tracker.track(new Float32Array(this.displacement_count));

        let r = this.getRandomInt(5, 25);
        for (let i = 0; i < this.displacement.length; i++) {
            this.noise[ i ] = Math.random() * r;
        }
        return this.random_geometry();
    }

    sphere_random() {

        const radius = this.getRandomInt(50, 150), segments = this.getRandomInt(100, 200), rings = this.getRandomInt(50, 80);
        const geometry = tracker.track(new THREE.SphereBufferGeometry(radius, segments, rings));

        this.displacement_count = geometry.attributes.uv.count;

        this.add_shader();

        geometry.setAttribute('displacement', tracker.track(new THREE.BufferAttribute(this.displacement, 1)));
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometry.attributes.position.array, 3));

        this.res = tracker.track(new THREE.Mesh(geometry, this.shaderMaterial));
    }

    cube_random() {

        const geometry = new THREE.BoxBufferGeometry(this.getRandomInt(50, 150), this.getRandomInt(50, 150), this.getRandomInt(50, 150), this.getRandomInt(10, 50), this.getRandomInt(10, 50), this.getRandomInt(10, 50));

        this.displacement_count = geometry.attributes.uv.count;

        this.add_shader();

        geometry.setAttribute('displacement', tracker.track(new THREE.BufferAttribute(this.displacement, 1)));
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometry.attributes.position.array, 3));

        this.res = tracker.track(new THREE.Mesh(geometry, this.shaderMaterial));
    }

    async random_geometry() {
        tracker.disposeNode('resources');
        switch (this.mode[ this.getRandomInt(0, Object.keys(this.mode).length) ]) {
            case 'sphere':
                this.sphere_random();
                break;
            case 'cube':
                this.cube_random();
                break;
            case 'gltf':
                this.res = await this.gltf_get();
                break;
        }
  
        return this.res;
    }

}

class ComplexNumber {
    constructor(r, i) {
        this.r = r;
        this.i = i;
    }
    ;
            //расстояние до центра
            mag() {
        return Math.hypot(this.r, this.i);
    }
    ;
            //сложение
            add(nmb) {
        this.r += nmb.r;
        this.i += nmb.i;
        return this;
    }
    ;
            //умножение
            square() {
        let r = this.r;
        let i = this.i;
        this.r = (r * r) - (i * i);
        this.i = 2 * r * i;
        return this;
    }
    ;
}
;

class RandDoter {

    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min)) + min; //Максимум не включается, минимум включается
    }

    rgb_parts(rgb_string) {
        let s = rgb_string.replace('rgb(', '').replace(')', '').split(',');
        return s;
    }

    add_custom_dots(custom_mesh) {
        this.vertices = [];
        var colors = [];
        this.sizes = [];
        let w = 100;
        let colores = new THREE.Color();
        for (let x = 0; x < w; x += 1) {
            for (let y = 0; y < w; y += 1) {
                let z = new ComplexNumber(0, 0);

                let color = "rgb(0, 0, 0, 1)";

                this.vertices.push(this.getRandomInt(1, 205) - this.getRandomInt(1, 205), this.getRandomInt(1, 205) - this.getRandomInt(1, 205), this.getRandomInt(1, 205) - this.getRandomInt(1, 205));

                let col = this.rgb_parts(color);

                let cl = colores.setHSL(0.1, 1.0, 0.5);
                colors.push(col[2], cl.g, col[1]);

                this.sizes.push(this.getRandomInt(1, 25));
            }
        }


        var geometry = tracker.track(new THREE.BufferGeometry());

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(custom_mesh.geometry.attributes.position.array, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3, true));

        var material = new THREE.PointsMaterial({vertexColors: THREE.VertexColors, color: colors, size: this.getRandomInt(1, 10)});


        let points = tracker.track(new THREE.Points(geometry, material));
        return points;

    }

    add_random_points() {
        var geometry2 = tracker.track(new THREE.BufferGeometry());
        geometry2.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
        geometry2.setAttribute('scale', new THREE.Float32BufferAttribute(this.sizes, 1));

        const material2 = new THREE.ShaderMaterial({
            uniforms: {
                color: {value: new THREE.Color(0xffffff)},
            },
            transparent: true,
            opacity: 0.1,
            vertexShader: document.getElementById('points_vertexshader').textContent,
            fragmentShader: document.getElementById('points_fragmentshader').textContent

        });

        let points_other = tracker.track(new THREE.Points(geometry2, material2));

        return points_other;
    }
}


class Visualle {
    constructor() {
        this.rand_mesh = new RandMesher();
        this.rand_dots = new RandDoter();
        this.startTime = 0;
        this.pauseTime = Date.now();
        this.hdrs = 15;
        this.as = new AudioStream();

        this.init();
    }

    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min)) + min; //Максимум не включается, минимум включается
    }

    random_params() {
        this.rand1 = this.getRandomInt(1, 10);
        this.rand2 = this.getRandomInt(1, 10);
    }

    random_function(x) {

        let res;
        switch (this.rand1) {
            case 1:
                res = Math.cos(x);
                break;
            case 2:
                res = Math.atan(x);
                break;
            case 3:
                res = Math.tan(x);
                break;
            case 4:
                res = Math.log(x);
                break;
        }
    }

    setLighting() {

        let directionalLight = tracker.track(new THREE.DirectionalLight(0xffffff, 100000));

        directionalLight.position.set(100, 0, 0);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        const light = tracker.track(new THREE.AmbientLight(0x404040)); // soft white light
        this.scene.add(light);

        let self = this;

        new RGBELoader()
                .setDataType(THREE.UnsignedByteType)
                .setPath('hdri/')
                .load(self.getRandomInt(1,self.hdrs + 1)+'.hdr', function (texture) {

                    var envMap = pmremGenerator.fromEquirectangular(texture).texture;

                    self.scene.background = envMap;
                    self.scene.environment = envMap;
                    texture.dispose();
                    pmremGenerator.dispose();
                });
        var pmremGenerator = tracker.track(new THREE.PMREMGenerator(self.renderer));
        pmremGenerator.compileEquirectangularShader();
    }

    init() {
        this.camera = tracker.track(new THREE.PerspectiveCamera(this.getRandomInt(5,50), window.innerWidth / window.innerHeight, 1, 1000));
        this.camera.position.z = 500;

        this.scene = new THREE.Scene();
        this.scene.background = tracker.track(new THREE.Color(0x050505));

        this.add_custom_meshes();
        
        this.renderer = new THREE.WebGLRenderer({alpha: true});
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        const container = document.getElementById('container');
        container.appendChild(this.renderer.domElement);

        this.postprocessing_create();
        window.addEventListener('resize', this.onWindowResize);

    }

    rgb_parts(rgb_string) {
        let s = rgb_string.replace('rgb(', '').replace(')', '').split(',');
        return s;
    }

    async add_custom_meshes() {
        this.custom_mesh = await this.rand_mesh.get();
        this.scene.add(this.custom_mesh);

        this.points = this.rand_dots.add_custom_dots(this.custom_mesh);
        this.scene.add(this.points);

        if (this.getRandomInt(1, 4) === 1) {
            this.points_other = this.rand_dots.add_random_points();
            this.scene.add(this.points_other);
        }
    }

    reloader() {
        tracker.dispose();
        this.camera.fov = this.getRandomInt(5,50);
        this.postprocessing_create();
        this.setLighting();
        this.random_params();
        this.add_custom_meshes();
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(vAlee.animate);

        vAlee.startTime = vAlee.startTime + (Date.now() - vAlee.pauseTime);
        vAlee.pauseTime = Date.now();

        vAlee.render();
        vAlee.composer.render();
    }

    isPromise(p) {
        if (typeof p === 'object' && typeof p.then === 'function') {
            return true;
        }
        return false;
    }

    dots_render() {
        const time = Date.now() * 0.01;

        this.points.rotation.z = 0.01 * time;
        this.points.rotation.x = 0.01 * time;

        let j = 0;
        let l = this.points.geometry.attributes.position.array.length;
        let r1 = (this.rand1 > 5) ? 1 : -1;
        let r2 = (this.rand2 > 5) ? 1 : -1;
        for (let i = 0; i < l - 1; i++) {

            if (this.points.geometry.attributes.position.array[i] > 0 && this.as.get_by_index(6) > 100) {
                this.points.geometry.attributes.position.array[i] += this.as.get_by_index(6) / 1000 + Math.random() * (1 - r1);
            } else {
                if (this.as.get_by_index(4) > 50) {
                    this.points.geometry.attributes.position.array[i] -= Math.cos(time * this.as.get_by_index(3) + i);
                }
            }

            switch (j) {
                case 0:
                    this.points.geometry.attributes.color.array[i] = (this.as.get_by_index(4) / 100) + (this.as.get_by_index(7) / 255) * r1;
                    if (this.rand1 % 2 === 0) {
                        this.points.geometry.attributes.color.array[i] -= Math.sin(i / l);
                    }
                    j++;
                    break;
                case 1:
                    this.points.geometry.attributes.color.array[i] = (this.as.get_by_index(5) / 100) + (this.as.get_by_index(1) / 255) * r2;
                    if (this.rand1 % 2 === 0) {
                        this.points.geometry.attributes.color.array[i] -= Math.cos(i / l);
                    }
                    j++;
                    break;
                case 2:
                    this.points.geometry.attributes.color.array[i] = (this.as.get_by_index(9) / 100) + (this.as.get_by_index(1) / 255) * r1;
                    if (this.rand1 % 2 === 0) {
                        this.points.geometry.attributes.color.array[i] -= Math.tan(i / l);
                    }
                    j = 0;
                    break;
            }

            if (this.rand1 < 2) {
                this.points.geometry.attributes.color.array[i] += i/ l * r1;
            }

        }

        if (this.points_other) {
            for (let i = 0; i < this.points_other.geometry.attributes.position.array.length - 1; i++) {
                this.points_other.geometry.attributes.position.array[i] += Math.cos(this.as.get_by_index(9)) / 10 + (Math.random() - Math.random()) / 10;
                this.points_other.geometry.attributes.scale.array[i] = 100 * (this.as.get_by_index(9) / 255) + this.rand1;
            }
            this.points_other.geometry.attributes.position.needsUpdate = true;
            this.points_other.geometry.attributes.scale.needsUpdate = true;
        }



        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;

    }

    postprocessing_create() {
        this.composer = tracker.track(new EffectComposer(this.renderer));
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = tracker.track(new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 1.5, 0.4, 0.85));
        this.bloomPass.threshold = 0;
        this.bloomPass.strength = this.getRandomInt(1, 3) / 10;
        this.bloomPass.radius = 0.1;
        this.composer.addPass(this.bloomPass);
        this.afterimagePass = new AfterimagePass(Math.random()); 
        this.composer.addPass(this.afterimagePass);

        if (this.rand1 % 2 === 0) {
            this.effectFilm = new FilmPass(Math.random(), Math.random(), Math.random() * 1000, false);
            this.composer.addPass(this.effectFilm);
        }
//
        if (this.rand1 === 1 || this.rand1 === 8) {
            var effectGrayScale = new ShaderPass(LuminosityShader);
            this.composer.addPass(effectGrayScale);
        }
        
//        this.effectSobel = tracker.track(new ShaderPass(SobelOperatorShader));
//        this.effectSobel.uniforms[ 'resolution' ].value.x = window.innerWidth * window.devicePixelRatio;
//        this.effectSobel.uniforms[ 'resolution' ].value.y = window.innerHeight * window.devicePixelRatio;
//        this.composer.addPass(this.effectSobel);

        this.bokehPass = tracker.track(new BokehPass(this.scene, this.camera, {
            focus: 10,
            aperture: Math.random() * 5,
            maxblur: 0.01,

            width: window.innerWidth,
            height: window.innerHeight
        }));

        if (this.rand1 > 7) {
            this.composer.addPass(this.bokehPass);
        }

    }

    render() {

        const time = Date.now() * 0.01;
        if (this.points) {
            this.dots_render();
        }

        this.camera.position.x = -50 * this.rand1 * Math.sin(time / 100);
        this.camera.position.z = -50 * this.rand1 * Math.cos(time / 100);
        if(this.rand1 % 2 === 0){
            this.camera.position.y = -50 * this.rand1 * Math.cos(time / 100);
        }

        this.camera.lookAt(this.rand_mesh.res.position);

        if (this.custom_mesh) {

            this.rand_mesh.uniforms[ 'amplitude' ].value = this.as.get_by_index(7) / 5000;

            for (var key in this.rand_mesh.uniforms[ 'color' ].value) {
                this.rand_mesh.uniforms[ 'color' ].value[key] = (this.rand_mesh.uniforms[ 'color' ].value[key] > 2) ? 2 : this.rand_mesh.uniforms[ 'color' ].value[key];
                this.rand_mesh.uniforms[ 'color' ].value[key] = (this.rand_mesh.uniforms[ 'color' ].value[key] < 0) ? 0 : this.rand_mesh.uniforms[ 'color' ].value[key];
                this.rand_mesh.uniforms[ 'color' ].value[key] += (this.as.get_by_index(this.getRandomInt(1, 6)) > 150) ? Math.random() / 20 : Math.random() * (-1) / 20;

            }


            let l = this.rand_mesh.res.geometry.attributes.position.array.length;

            for (let i = 0; i < this.rand_mesh.displacement_count; i++) {
                this.rand_mesh.noise[ i ] = THREE.MathUtils.clamp(this.rand_mesh.noise[ i ], -5, 5);
                this.rand_mesh.displacement[ i ] += this.as.get_by_index(this.rand1 - 1) / 2;
            }
            this.custom_mesh.geometry.attributes.displacement.needsUpdate = true;


            if (this.rand2 > 5) {
                for (let i = 1; i < l - 4; i += this.rand1) {
                    const x = Math.random() * this.as.get_by_index(3);
                    this.rand_mesh.res.geometry.attributes.position.array[ i ] += x / 1000;
                    this.rand_mesh.res.geometry.attributes.position.array[ i + 1 ] += x / 1000;
                    this.rand_mesh.res.geometry.attributes.position.array[ i + 2 ] += x / 1000;
                }

                this.custom_mesh.geometry.attributes.position.needsUpdate = true;
            }

        }

        this.renderer.render(this.scene, this.camera);


    }
}


var tracker = new ResourceTracker();

var vAlee = new Visualle();

vAlee.animate();

$("#container").click(function (event) { // обработка ссылок
    vAlee.reloader();
});

let clicker = setInterval(function() {
    $("#container").click();
}, 10000);
