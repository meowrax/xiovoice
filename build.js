const fs = require('fs');
const path = require('path');
const { minify: minifyHTML } = require('html-minifier-terser');
const { minify: minifyJS } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

async function build() {
    console.log('Building...');
    
    if (!fs.existsSync('dist')) {
        fs.mkdirSync('dist');
    }
    if (!fs.existsSync('dist/public')) {
        fs.mkdirSync('dist/public');
    }
    
    const serverCode = fs.readFileSync('server.js', 'utf8');
    const serverMinified = await minifyJS(serverCode, {
        mangle: true,
        compress: true
    });
    
    const serverObfuscated = JavaScriptObfuscator.obfuscate(serverMinified.code, {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        stringArray: true,
        stringArrayThreshold: 0.75,
        identifierNamesGenerator: 'hexadecimal'
    });
    
    fs.writeFileSync('dist/server.js', serverObfuscated.getObfuscatedCode());
    console.log('server.js minified and obfuscated');
    
    let htmlCode = fs.readFileSync('public/index.html', 'utf8');
    
    const scriptMatch = htmlCode.match(/<script>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
        const jsCode = scriptMatch[1];
        
        const jsMinified = await minifyJS(jsCode, {
            mangle: true,
            compress: true
        });
        
        const jsObfuscated = JavaScriptObfuscator.obfuscate(jsMinified.code, {
            compact: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            stringArray: true,
            stringArrayThreshold: 0.75,
            identifierNamesGenerator: 'hexadecimal'
        });
        
        htmlCode = htmlCode.replace(/<script>[\s\S]*?<\/script>/, `<script>${jsObfuscated.getObfuscatedCode()}</script>`);
    }
    
    const htmlMinified = await minifyHTML(htmlCode, {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: false
    });
    
    fs.writeFileSync('dist/public/index.html', htmlMinified);
    console.log('index.html minified and obfuscated');
    
    fs.writeFileSync('dist/package.json', JSON.stringify({
        name: "xiovoice",
        version: "1.0.0",
        main: "server.js",
        scripts: {
            start: "node server.js"
        },
        dependencies: {
            express: "^4.18.2",
            ws: "^8.14.2",
            uuid: "^9.0.0"
        }
    }, null, 2));
    
    console.log('Build complete! Files in dist/ folder');
}

build().catch(console.error);

