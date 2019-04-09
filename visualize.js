/*Copyright 2015-2019 Kirk McDonald

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.*/
"use strict"

const colorList = [
    "#1f77b4", // blue
    "#8c564b", // brown
    "#2ca02c", // green
    "#d62728", // red
    "#9467bd", // purple
    "#e377c2", // pink
    "#17becf", // cyan
    "#7f7f7f", // gray
    "#bcbd22", // yellow
    "#ff7f0e", // orange
]

function OutputRecipe() {
    this.ingredients = []
    for (var i = 0; i < build_targets.length; i++) {
        var target = build_targets[i]
        var item = solver.items[target.itemName]
        var ing = new Ingredient(target.getRate(), item)
        this.ingredients.push(ing)
    }
    this.products = []
}

function SurplusRecipe(totals) {
    this.ingredients = []
    for (var itemName in totals.waste) {
        var rate = totals.waste[itemName]
        var item = solver.items[itemName]
        var ing = new Ingredient(rate, item)
        this.ingredients.push(ing)
    }
    this.products = []
}

var image_id = zero

function makeGraph(totals, ignore) {
    var outputRecipe = new OutputRecipe()
    var nodes = [{
        name: "output",
        ingredients: outputRecipe.ingredients,
        recipe: outputRecipe,
        factory: null,
        count: zero,
        rate: null,
    }]
    var nodeMap = new Map()
    nodeMap.set("output", nodes[0])
    if (Object.keys(totals.waste).length > 0) {
        var surplusRecipe = new SurplusRecipe(totals)
        nodes.push({
            name: "surplus",
            ingredients: surplusRecipe.ingredients,
            recipe: surplusRecipe,
            factory: null,
            count: zero,
            rate: null,
        })
        nodeMap.set("surplus", nodes[1])
    }
    for (var recipeName in totals.totals) {
        var rate = totals.totals[recipeName]
        var recipe = solver.recipes[recipeName]
        var factory = spec.getFactory(recipe)
        var factoryCount = spec.getCount(recipe, rate)
        var node = {
            name: recipeName,
            ingredients: recipe.ingredients,
            recipe: recipe,
            factory: factory ? factory.factory : null,
            count: factoryCount,
            rate: rate,
        }
        nodes.push(node)
        nodeMap.set(recipeName, node)
    }
    var links = []
    for (let node of nodes) {
        var recipe = node.recipe
        if (ignore[recipe.name]) {
            continue
        }
        var ingredients = []
        if (recipe.fuelIngredient) {
            ingredients = recipe.fuelIngredient(spec)
        }
        var fuelIngCount = ingredients.length
        ingredients = ingredients.concat(recipe.ingredients)
        for (let [i, ing] of ingredients.entries()) {
            var fuel = i < fuelIngCount
            var totalRate = zero
            for (let subRecipe of ing.item.recipes) {
                if (subRecipe.name in totals.totals) {
                    totalRate = totalRate.add(totals.totals[subRecipe.name].mul(subRecipe.gives(ing.item, spec)))
                }
            }
            for (let subRecipe of ing.item.recipes) {
                if (subRecipe.name in totals.totals) {
                    var rate
                    if (node.name === "output" || node.name === "surplus") {
                        rate = ing.amount
                    } else {
                        rate = totals.totals[recipe.name].mul(ing.amount)
                    }
                    var ratio = rate.div(totalRate)
                    var subRate = totals.totals[subRecipe.name].mul(subRecipe.gives(ing.item, spec)).mul(ratio)
                    let value = subRate.toFloat()
                    if (ing.item.phase === "fluid") {
                        value /= 10
                    }
                    let extra = subRecipe.products.length > 1
                    links.push({
                        source: nodeMap.get(subRecipe.name),
                        target: node,
                        value: value,
                        item: ing.item,
                        rate: subRate,
                        fuel: fuel,
                        extra: extra,
                    })
                }
            }
        }
    }
    return {nodes, links}
}

function GraphEdge(edge) {//, label) {
    this.edge = edge
    //this.label = label
    this.nodes = new Set()
}
GraphEdge.prototype = {
    constructor: GraphEdge,
    hasNodes: function() {
        return this.nodes.size > 0
    },
    highlight: function(node) {
        if (!this.hasNodes()) {
            this.edge.element.classList.add("edgePathHighlight")
            //this.label.classList.add("edgeLabelHighlight")
        }
        this.nodes.add(node)
    },
    unhighlight: function(node) {
        this.nodes.delete(node)
        if (!this.hasNodes()) {
            this.edge.element.classList.remove("edgePathHighlight")
            //this.label.classList.remove("edgeLabelHighlight")
        }
    },
}

function GraphNode(node, edges) {
    this.node = node
    this.edges = edges
}
GraphNode.prototype = {
    constructor: GraphNode,
    highlight: function() {
        this.node.element.classList.add("nodeHighlight")
        for (let edge of this.edges) {
            edge.highlight(this)
        }
    },
    unhighlight: function() {
        this.node.element.classList.remove("nodeHighlight")
        for (let edge of this.edges) {
            edge.unhighlight(this)
        }
    },
}

function nodeText(d) {
    if (d.rate === null) {
        return d.name
    } else if (d.count.isZero()) {
        return sprintf(" \u00d7 %s/%s", displayRate(d.rate), rateName)
    } else {
        return sprintf(" \u00d7 %s", displayCount(d.count))
    }
}

const iconSize = 32
const nodePadding = 32
const columnWidth = 200
const maxNodeHeight = 175
const colonWidth = 12

var color = d3.scaleOrdinal(colorList)

function imageViewBox(obj) {
    var x1 = obj.icon_col * PX_WIDTH
    var y1 = obj.icon_row * PX_HEIGHT
    return `${x1} ${y1} ${PX_WIDTH} ${PX_HEIGHT}`
}

function itemNeighbors(item, fuelLinks) {
    let touching = new Set()
    let recipes = item.recipes.concat(item.uses)
    let fuelUsers = fuelLinks.get(item)
    if (fuelUsers !== undefined) {
        recipes = recipes.concat(fuelUsers)
    }
    for (let recipe of recipes) {
        let ingredients = recipe.ingredients.concat(recipe.products)
        if (recipe.fuelIngredient) {
            ingredients = ingredients.concat(recipe.fuelIngredient(spec))
        }
        for (let ing of ingredients) {
            touching.add(ing.item)
        }
    }
    return touching
}

function itemDegree(item, fuelLinks) {
    return itemNeighbors(item, fuelLinks).size
}

function getColorMaps(nodes, links) {
    let itemColors = new Map()
    let recipeColors = new Map()
    let fuelLinks = new Map()
    let items = []
    for (let link of links) {
        items.push(link.item)
        if (link.fuel) {
            let fuelUsers = fuelLinks.get(link.item)
            if (fuelUsers === undefined) {
                fuelUsers = []
                fuelLinks.set(link.item, fuelUsers)
            }
            fuelUsers.push(link.target.recipe)
        }
    }
    items.sort(function (a, b) {
        return itemDegree(b, fuelLinks) - itemDegree(a, fuelLinks)
    })
    items = new Set(items)
    while (items.size > 0) {
        let chosenItem = null
        let usedColors = null
        let max = -1
        for (let item of items) {
            let neighbors = itemNeighbors(item, fuelLinks)
            let colors = new Set()
            for (let neighbor of neighbors) {
                if (itemColors.has(neighbor)) {
                    colors.add(itemColors.get(neighbor))
                }
            }
            if (colors.size > max) {
                max = colors.size
                usedColors = colors
                chosenItem = item
            }
        }
        items.delete(chosenItem)
        let color = 0
        while (usedColors.has(color)) {
            color++
        }
        itemColors.set(chosenItem, color)
    }
    // This is intended to be taken modulo the number of colors when it is
    // actually used.
    let recipeColor = 0
    for (let node of nodes) {
        let recipe = node.recipe
        if (recipe.products.length === 1) {
            recipeColors.set(recipe, itemColors.get(recipe.products[0].item))
        } else {
            recipeColors.set(recipe, recipeColor++)
        }
    }
    return [itemColors, recipeColors]
}

function linkTitle(d) {
    let itemName = ""
    if (d.source.name !== d.item.name) {
        itemName = `${formatName(d.item.name)} \u00d7 `
    }
    let fuel = ""
    if (d.fuel) {
        fuel = " (fuel)"
    }
    return `${formatName(d.source.name)} \u2192 ${formatName(d.target.name)}${fuel}\n${itemName}${displayRate(d.rate)}/${rateName}`
}

function renderGraph(totals, ignore) {
    let spriteImage = new Image()
    spriteImage.src = "images/sprite-sheet-" + sheet_hash + ".png"
    let sheetWidth = spriteImage.width
    let sheetHeight = spriteImage.height
    let data = makeGraph(totals, ignore)

    let maxNodeWidth = 0
    let testSVG = d3.select("body").append("svg")
    let text = testSVG.append("text")
    for (let node of data.nodes) {
        text.text(nodeText(node))
        let textWidth = text.node().getBBox().width
        let nodeWidth = textWidth + 4
        if (node.factory !== null) {
            nodeWidth += iconSize * 2 + colonWidth
        } else if (node.rate !== null) {
            nodeWidth += iconSize
        }
        if (nodeWidth > maxNodeWidth) {
            maxNodeWidth = nodeWidth
        }
    }
    text.remove()
    testSVG.remove()

    let sankey = d3sankey.sankey()
        .nodeWidth(maxNodeWidth)
        .nodePadding(nodePadding)
        .nodeAlign(d3sankey.sankeyRight)
        .maxNodeHeight(maxNodeHeight)
        .linkLength(columnWidth)
    let {nodes, links} = sankey(data)
    let [itemColors, recipeColors] = getColorMaps(nodes, links)
    let width = 0
    let height = 0
    for (let node of nodes) {
        if (node.x1 > width) {
            width = node.x1
        }
        if (node.y1 > height) {
            height = node.y1
        }
    }

    let linkHighlighters = new Map()
    for (let link of links) {
        let h = new GraphEdge(link)
        linkHighlighters.set(link, h)
    }
    for (let node of nodes) {
        let edges = []
        for (let link of node.sourceLinks.concat(node.targetLinks)) {
            edges.push(linkHighlighters.get(link))
        }
        node.highlighter = new GraphNode(node, edges)
    }

    var svg = d3.select("svg#graph")
        .attr("viewBox", `-25,-25,${width+50},${height+50}`)
        .style("width", width+50)
        .style("height", height+50)
    svg.selectAll("g").remove()

    let rects = svg.append("g")
        .classed("nodes", true)
        .selectAll("g")
        .data(nodes)
        .join("g")
            .classed("node", true)

    rects.append("rect")
        .attr("x", d => d.x0)
        .attr("y", d => d.y0)
        .attr("height", d => d.y1 - d.y0)
        .attr("width", d => d.x1 - d.x0)
        .attr("fill", d => d3.color(colorList[recipeColors.get(d.recipe) % 10]).darker())
        .attr("stroke", d => colorList[recipeColors.get(d.recipe) % 10])
        .each(function(d) { d.element = this })
    rects.filter(d => d.rate === null)
        .append("text")
            .attr("x", d => (d.x0 + d.x1) / 2)
            .attr("y", d => (d.y0 + d.y1) / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .text(nodeText)
    let labeledNode = rects.filter(d => d.rate !== null)
    labeledNode.append("svg")
        .attr("viewBox", d => imageViewBox(d.recipe))
        .attr("x", d => d.x0 + 2)
        .attr("y", d => (d.y0 + d.y1) / 2 - iconSize/2)
        .attr("width", iconSize)
        .attr("height", iconSize)
        .append("image")
            .classed("ignore", d => ignore[d.recipe.name])
            .attr("xlink:href", "images/sprite-sheet-" + sheet_hash + ".png")
            .attr("width", sheetWidth)
            .attr("height", sheetHeight)
    labeledNode.append("text")
        .attr("x", d => d.x0 + iconSize + (d.factory === null ? 0 : colonWidth + iconSize) + 2)
        .attr("y", d => (d.y0 + d.y1) / 2)
        .attr("dy", "0.35em")
        .text(nodeText)
    let factoryNode = rects.filter(d => d.factory !== null)
    factoryNode.append("circle")
        .classed("colon", true)
        .attr("cx", d => d.x0 + iconSize + colonWidth/2 + 2)
        .attr("cy", d => (d.y0 + d.y1) / 2 - 4)
        .attr("r", 1)
    factoryNode.append("circle")
        .classed("colon", true)
        .attr("cx", d => d.x0 + iconSize + colonWidth/2 + 2)
        .attr("cy", d => (d.y0 + d.y1) / 2 + 4)
        .attr("r", 1)
    factoryNode.append("svg")
        .attr("viewBox", d => imageViewBox(d.factory))
        .attr("x", d => d.x0 + iconSize + colonWidth + 2)
        .attr("y", d => (d.y0 + d.y1) / 2 - iconSize/2)
        .attr("width", iconSize)
        .attr("height", iconSize)
        .append("image")
            .attr("xlink:href", "images/sprite-sheet-" + sheet_hash + ".png")
            .attr("width", sheetWidth)
            .attr("height", sheetHeight)

    let link = svg.append("g")
        .classed("links", true)
        .selectAll("g")
        .data(links)
        .join("g")
    link.append("path")
        .attr("fill", "none")
        .attr("stroke-opacity", 0.3)
        .attr("d", d3sankey.sankeyLinkHorizontal())
        .attr("stroke", d => colorList[itemColors.get(d.item) % 10])
        .attr("stroke-width", d => Math.max(1, d.width))
        .each(function(d) { d.element = this })
    link.append("title")
        .text(linkTitle)
    let extraLinkLabel = link.filter(d => d.extra)
    extraLinkLabel.append("svg")
        .attr("viewBox", d => imageViewBox(d.item))
        .attr("x", d => d.source.x1 + 2)
        .attr("y", d => d.y0 - PX_HEIGHT/4)
        .attr("width", iconSize/2)
        .attr("height", iconSize/2)
        .append("image")
            .attr("xlink:href", "images/sprite-sheet-" + sheet_hash + ".png")
            .attr("width", sheetWidth)
            .attr("height", sheetHeight)
    link.append("text")
        .attr("x", d => d.source.x1 + 2 + (d.extra ? 16 : 0))
        .attr("y", d => d.y0)
        .attr("dy", "0.35em")
        .attr("text-anchor", "start")
        .text(d => (d.extra ? "\u00d7 " : "") + `${displayRate(d.rate)}/${rateName}`)

    let rectElements = svg.selectAll("g.node rect").nodes()
    let overlayData = []
    let graphTab = d3.select("#graph_tab")
    let origDisplay = d3.style(graphTab.node(), "display")
    graphTab.style("display", "block")
    for (let [i, node] of nodes.entries()) {
        let rect = rectElements[i].getBBox()
        let recipe = node.recipe
        overlayData.push({rect, node, recipe})
    }
    graphTab.style("display", origDisplay)
    svg.append("g")
        .classed("overlay", true)
        .selectAll("rect")
        .data(overlayData)
        .join("rect")
            .attr("stroke", "none")
            .attr("fill", "transparent")
            .attr("x", d => d.rect.x)
            .attr("y", d => Math.min(d.rect.y, d.rect.y + d.rect.height/2 - 16))
            .attr("width", d => d.rect.width)
            .attr("height", d => Math.max(d.rect.height, 32))
            .on("mouseover", d => GraphMouseOverHandler(d.node.highlighter))
            .on("mouseout", d => GraphMouseLeaveHandler(d.node.highlighter))
            .on("click", d => GraphClickHandler(d.node.highlighter))
            .append("title")
                .text(d => formatName(d.node.name))
}
